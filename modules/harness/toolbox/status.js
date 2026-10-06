'use strict';

/**
 * What is running: the system, MCP servers, and paired clients.
 */

const { clip } = require('./common');

/**
 * Which MCP server a device hosts, so the agent knows it lends hands (audit 2026-10-06, aw 20): its id, state and the
 * families its tools fall in — `hands=docamobile-pixel (running: screen, apps, media ×3…)`. Empty when it hosts none.
 */
function hands(deviceId) {
  try {
    const reg = require('../../mcp/registry');
    const mine = reg.list().filter(srv => srv.origin?.kind === 'client' && srv.origin.deviceId === deviceId);
    return mine.map(srv => {
      const names = reg.lastTools(srv.id)?.names || [];
      const fams = [...new Set(names.map(n => String(n).split('_')[0]))].slice(0, 8).join(', ');
      return `hands=${srv.id} (${srv.state}${fams ? `: ${fams}` : ''}${srv.state === 'running' ? '' : ' — mcp_connect starts it'})`;
    }).join('  ');
  } catch { return ''; }
}

module.exports = [
  {
    name: 'system_status',
    description: 'Current state of the machine: CPU, RAM, GPU, disks, running containers, and every local model server with what it has '
      + 'loaded and who it is working for — DOCA (which conversation) or something else on this machine.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const s = await require('../../controls').collectStatus();
      // Model servers, whoever started them (model-servers.js, the sidebar's ◆): a busy GPU with none of DOCA's
      // requests in flight reads "for something else" (audit 2026-10-06, aw 9).
      let models = [];
      try {
        models = (await require('../../model-servers').status()).servers.map(v => ({
          server: v.label, url: v.url, models: (v.models || []).map(m => `${m.id || m.name}${m.state ? ` (${m.state})` : ''}`),
          forDoca: v.doca.map(d => d.text), forSomethingElse: v.foreign || undefined }));
      } catch { /* none answering */ }
      return clip(`${models.length ? `Model servers: ${JSON.stringify(models)}\n` : ''}${JSON.stringify(s, null, 1)}`, 7000);
    },
  },
  {
    name: 'mcp_connect',
    description: 'Connect to an MCP server a person already set up (the environment lists them), or disconnect one — '
      + 'e.g. start a client\'s server to use its tools on that machine. It never adds or changes a server, and it cannot '
      + 'reach a machine that is asleep or a client that is not running. Its tools appear on your next step.',
    parameters: { type: 'object', properties: { server: { type: 'string', description: 'Its id, as the environment lists it.' },
      action: { type: 'string', enum: ['start', 'stop'] } }, required: ['server', 'action'] },
    run: async ({ server, action }) => {
      const reg = require('../../mcp/registry');
      if (!reg.get(String(server || ''))) return `Error: no MCP server "${server}". Configured: ${reg.list().map(s => s.id).join(', ') || 'none'}.`;
      if (action === 'stop') { reg.stop(server); return `Disconnected ${server}.`; }
      try {
        const c = await reg.start(server);
        return `Connected to ${server}: ${c.tools.length} tools, called mcp__${reg.slug ? reg.slug(server) : server}__<tool>, available from your next step.`;
      } catch (e) { return `Error: could not connect to ${server}: ${e.message}`; }
    },
  },
  {
    name: 'mcp_status',
    description: 'Read the configured MCP servers, their machines, DOCA connection state, backend observations '
      + 'and tool counts. This does not connect, start or stop anything. A stopped connection does not prove '
      + 'a remote listener is down; a running connection does not prove its backend answers.',
    parameters: { type: 'object', properties: {} },
    run: () => {
      const rows = require('../../mcp/registry').list().map(s => ({
        id: s.id, label: s.label, transport: s.transport, origin: s.origin, originLabel: s.originLabel,
        state: s.state, backend: s.backend || 'unknown', backendObservedAt: s.backendObservedAt || null,
        toolCount: s.toolCount, error: s.error,
      }));
      return clip('MCP state describes DOCA\'s connection, not the remote listener or backend health.\n'
        + (rows.length ? JSON.stringify(rows, null, 1) : 'No MCP servers are configured.'));
    },
  },
  {
    name: 'doca_clients',
    description: 'The devices paired with this hub and which of them are reachable right now: form factor, online state, queued events, last seen, what each is allowed to do, and which lend you tools (hands=…: their MCP server, to act on that device). Use it before deciding where to reach the user — asking a watch that is offline gets queued, asking one that cannot chat gets nothing.',
    parameters: { type: 'object', properties: {} },
    run: () => {
      // Required here rather than at the top: this is the harness reaching into
      // the client layer, and the client layer's own adapter reaches back here.
      const devices = require('../../api-v1/devices');
      const bus     = require('../../api-v1/bus');
      const { hasScope } = require('../../api-v1/scopes');

      const live = devices.list().filter(d => !d.revokedAt);
      if (!live.length) return 'No devices are paired with this hub yet. Pairing happens in the dashboard (Devices), not from here.';

      // "Connected" used to mean "a stream is open", so a phone that polls read
      // offline while it fetched every few seconds (audit 2026-09-26, §4a/§4b).
      // Now: how it is reached, and where its events stand.
      const ago = t => (t ? `${Math.max(0, Math.round((Date.now() - Date.parse(t)) / 1000))}s ago` : 'never');
      const reach = (d, q) => (q.streaming ? 'STREAM' : q.lastPollAt && Date.now() - Date.parse(q.lastPollAt) < 120e3 ? `POLLING (last poll ${ago(q.lastPollAt)})` : 'offline');
      const rows = live.map(d => {
        const can = [
          hasScope(d.scopes, 'harness:chat') && 'chat',
          hasScope(d.scopes, 'interact')     && 'prompts',
          hasScope(d.scopes, 'command:*')    && 'commands',
          hasScope(d.scopes, 'sensors:report') && 'sensors',
        ].filter(Boolean).join(',') || 'read-only';
        const q = bus.delivery(d.id);
        return [
          d.id, d.name,
          d.kind === 'agent' ? 'agent' : (d.caps?.formFactor || 'device'),
          reach(d, q),
          q.pending ? `queued=${q.pending} (${q.delivered} fetched but not acknowledged, ${q.unfetched} not fetched; oldest ${ago(q.oldestPendingAt)})` : 'queued=0',
          `lastSeen=${ago(d.lastSeenAt)}`,
          `can=${can}`,
          // That it has a console and where it goes; what it streams never reaches a model.
          require('../../device-console').summary(d.id, id => devices.get(id)?.name || id),
          hands(d.id),
        ].filter(Boolean).join('  ');
      });

      // The counts first: a model that only reads the first line still answers
      // "who is connected" correctly.
      const qs = live.map(d => [d, bus.delivery(d.id)]);
      const streaming = qs.filter(([, q]) => q.streaming).length;
      const polling = qs.filter(([, q]) => !q.streaming && q.lastPollAt && Date.now() - Date.parse(q.lastPollAt) < 120e3).length;
      return `${live.length} paired: ${streaming} with a stream open, ${polling} polling, ${live.length - streaming - polling} not heard from in 2 minutes.\n${rows.join('\n')}\n`
        + '"Fetched but not acknowledged" means the device received those events and has not sent its cursor back; they are delivered, and the queue will not shrink until it does. '
        + 'These are the hub\'s own paired clients. Sockets and tailnet peers are a different question — use system_status or shell for those.';
    },
  },
];
