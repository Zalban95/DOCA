'use strict';

/**
 * What is running: the system, MCP servers, and paired clients.
 */

const { clip } = require('./common');

module.exports = [
  {
    name: 'system_status',
    description: 'Current state of the machine: CPU, RAM, GPU, disks, running containers and local models.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const s = await require('../../controls').collectStatus();
      return clip(JSON.stringify(s, null, 1), 6000);
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
    description: 'The devices paired with this hub and which of them are reachable right now: form factor, online state, queued events, last seen, and what each is allowed to do. Use it before deciding where to reach the user — asking a watch that is offline gets queued, asking one that cannot chat gets nothing.',
    parameters: { type: 'object', properties: {} },
    run: () => {
      // Required here rather than at the top: this is the harness reaching into
      // the client layer, and the client layer's own adapter reaches back here.
      const devices = require('../../api-v1/devices');
      const bus     = require('../../api-v1/bus');
      const { hasScope } = require('../../api-v1/scopes');

      const live = devices.list().filter(d => !d.revokedAt);
      if (!live.length) return 'No devices are paired with this hub yet. Pairing happens in the dashboard (Devices), not from here.';

      const rows = live.map(d => {
        const can = [
          hasScope(d.scopes, 'harness:chat') && 'chat',
          hasScope(d.scopes, 'interact')     && 'prompts',
          hasScope(d.scopes, 'command:*')    && 'commands',
          hasScope(d.scopes, 'sensors:report') && 'sensors',
        ].filter(Boolean).join(',') || 'read-only';
        const pending = bus.pendingCount(d.id);
        return [
          d.id,
          d.name,
          d.kind === 'agent' ? 'agent' : (d.caps?.formFactor || 'device'),
          bus.isOnline(d.id) ? 'ONLINE' : 'offline',
          `queued=${pending}`,
          `lastSeen=${d.lastSeenAt || 'never'}`,
          `can=${can}`,
        ].join('  ');
      });

      // The counts first: a model that only reads the first line still answers
      // "who is connected" correctly.
      const online = live.filter(d => bus.isOnline(d.id)).length;
      return `${live.length} paired, ${online} connected right now.\n${rows.join('\n')}\n`
        + 'These are the hub\'s own paired clients. Sockets and tailnet peers are a different question — use system_status or shell for those.';
    },
  },
];
