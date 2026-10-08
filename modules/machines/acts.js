'use strict';

/**
 * Who started, stopped or removed a machine, written down (asked 2026-10-08: "I started the VMs manually, log the
 * actions so there is no confusion"). The hub's own acts were already lines (activity.js, "nothing runs unseen"); this
 * adds the people's and the agents': every start, stop, restart, kill, remove, take-over, adoption or deletion of a
 * container, an inference service, a llama.cpp server, a VM, a computer, a VNC screen, the stack or an MCP server —
 *   from the panel    one middleware over the routes that act (ROUTES), after the handler answered: who (the signed-in
 *                     person), from which screen (the browser's device record) or device (a device's own page), and
 *                     whether it worked
 *   from a device     api-v1/commands.js calls `command()` with the device (its person and name)
 *   from an agent     acts-agent.js, from the turn's tool calls (hub_command, mcp_connect, computer): which conversation
 *   a take-over       the drive socket of a computer or a VNC screen (terminal.js calls `upgrade()`)
 * Each is `activity.note({from: 'person'|'agent', machine, act, via, ok, person})`, so Chronicle's `hub` source lists it
 * and a machine row says who started it (origin.js). Names and outcomes only — never a body, a password or a token.
 */
const VERB = { start: 'started', stop: 'stopped', restart: 'restarted', reboot: 'rebooted', kill: 'cut the power to', resume: 'resumed',
  remove: 'removed', rm: 'removed', delete: 'deleted', create: 'made', run: 'ran', adopt: 'adopted', archive: 'put away', restore: 'brought back',
  add: 'added', update: 'updated', 'take-over': 'took over', pause: 'paused', unpause: 'resumed' };
const LABEL = { container: 'the container', service: 'the inference service', llamacpp: 'the llama.cpp server', vm: 'the VM',
  computer: 'the computer', vnc: 'the VNC screen', stack: '', mcp: 'the MCP server' };

const stackId = () => require('./use').stackProject();

function nameOf(kind, id) {
  try {
    if (kind === 'service') return require('../services').INFERENCE_SERVICES.find(s => s.id === id)?.label || id;
    if (kind === 'llamacpp') return require('../models-llamacpp').loadInstances().find(i => i.id === id)?.name || id;
    if (kind === 'computer') return require('../computers').get(id)?.name || id;
    if (kind === 'vnc') return require('../vnc-targets/store').find(id)?.name || id;
    if (kind === 'vm') return String(id).split(':').slice(1).join(':') || id;
    if (kind === 'mcp') { const s = require('../mcp/registry').get(id); return s?.label || s?.name || id; }
    if (kind === 'stack') return 'the stack';
  } catch { /* the id will do */ }
  return id;
}

/** A container is kept by its name: its id changes when it is made again, and a removed one has no id to ask about. */
async function containerName(id) {
  const hit = c => c.ID === id || String(c.ID || '').startsWith(id) || String(c.Names || '').split(',').includes(id);
  const cached = require('./rows').cached()?.rows?.find(r => r.kind === 'container' && (r.id === id || String(r.id).startsWith(id) || r.name === id));
  if (cached) return cached.name;
  try { const c = (await require('../containers').ps({ all: true })).find(hit); if (c) return String(c.Names || '').split(',')[0]; } catch { /* no docker */ }
  return id;
}

/** One act, written down. `by`: { from: 'person'|'agent', person, via, sessionId }. */
function note({ kind, id, act, name = null, ok = null, error = null }, by = {}) {
  if (!kind || !id || !VERB[act]) return null;
  const label = name || nameOf(kind, id);
  const what = `${VERB[act]} ${LABEL[kind] ? `${LABEL[kind]} ` : ''}${label}`;
  const why = [by.via && `from ${by.via}`, ok === false && `it failed${error ? `: ${String(error).split('\n')[0].slice(0, 160)}` : ''}`].filter(Boolean).join('; ');
  const row = require('../activity').note({ from: by.from || 'person', what, why, person: by.person || null, sessionId: by.sessionId || null,
    level: ok === false ? 'warn' : 'info', machine: { kind, id, name: label }, act, via: by.via || null, ok });
  try { require('./rows')._reset(); require('./origin')._reset(); } catch { /* the next read is fresh anyway */ }
  return row;
}

/** Where a panel request came from: the device a device-token session opened, else this browser's screen record. */
function viaOf(req) {
  const s = req.auth?.session || {};
  try {
    const d = require('../api-v1/devices').get(s.deviceId || s.screen || '');
    if (d) return d.kind === 'browser' ? `the screen ${d.name}` : `the device ${d.name}`;
  } catch { /* no registry */ }
  return 'the panel';
}

const personOf = user => (user?.id ? { id: user.id, name: user.name || user.email || user.id } : null);

/** The panel's routes that act on a machine: [method, path, (req, match, answer) → {kind, id, act} | null]. */
const ROUTES = [
  ['POST', /^\/api\/action$/, r => ['start', 'stop', 'restart'].includes(r.body?.action) && { kind: 'stack', id: stackId(), act: r.body.action }],
  ['POST', /^\/api\/stack\/update$/, () => ({ kind: 'stack', id: stackId(), act: 'update' })],
  ['POST', /^\/api\/docker\/containers\/([^/]+)\/action$/, (r, m) => ({ kind: 'container', id: decodeURIComponent(m[1]), act: r.body?.action, container: true })],
  ['POST', /^\/api\/docker\/run$/, r => (r.body?.name ? { kind: 'container', id: String(r.body.name), act: 'run' } : null)],
  ['POST', /^\/api\/services\/(start|stop)$/, (r, m) => r.body?.id && { kind: 'service', id: String(r.body.id), act: m[1] }],
  ['POST', /^\/api\/models\/llamacpp\/(start|stop|restart)$/, (r, m) => r.body?.id && { kind: 'llamacpp', id: String(r.body.id), act: m[1] }],
  ['DELETE', /^\/api\/models\/llamacpp\/([^/]+)$/, (r, m) => ({ kind: 'llamacpp', id: decodeURIComponent(m[1]), act: 'delete' })],
  ['POST', /^\/api\/vms\/([\w-]+)\/action$/, (r, m) => r.body?.name && { kind: 'vm', id: `${m[1]}:${r.body.name}`, act: r.body.action }],
  ['POST', /^\/api\/computers$/, () => ({ kind: 'computer', id: null, act: 'create', fromAnswer: a => a?.id })],
  ['POST', /^\/api\/computers\/([a-f0-9]+)\/(start|stop)$/, (r, m) => ({ kind: 'computer', id: m[1], act: m[2] })],
  ['DELETE', /^\/api\/computers\/([a-f0-9]+)$/, (r, m) => ({ kind: 'computer', id: m[1], act: 'remove' })],
  ['POST', /^\/api\/computers\/strays\/([^/]+)\/archive$/, (r, m) => ({ kind: 'container', id: decodeURIComponent(m[1]), act: 'adopt' })],
  ['DELETE', /^\/api\/computers\/strays\/([^/]+)$/, (r, m) => ({ kind: 'container', id: decodeURIComponent(m[1]), act: 'delete' })],
  ['POST', /^\/api\/archive\/computer\/([^/]+)$/, (r, m) => ({ kind: 'computer', id: decodeURIComponent(m[1]), act: r.body?.on === false ? 'restore' : 'archive' })],
  ['POST', /^\/api\/machines\/vnc$/, () => ({ kind: 'vnc', id: null, act: 'add', fromAnswer: a => a?.id })],
  ['DELETE', /^\/api\/machines\/vnc\/([^/]+)$/, (r, m) => ({ kind: 'vnc', id: decodeURIComponent(m[1]), act: 'remove' })],
  ['POST', /^\/api\/mcp\/([^/]+)\/action$/, (r, m) => ({ kind: 'mcp', id: decodeURIComponent(m[1]), act: r.body?.action })],
  ['DELETE', /^\/api\/mcp\/([^/]+)$/, (r, m) => ({ kind: 'mcp', id: decodeURIComponent(m[1]), act: 'remove' })],
];

function match(req) {
  for (const [method, re, fn] of ROUTES) {
    if (req.method !== method) continue;
    const m = re.exec(req.path);
    if (m) { const a = fn(req, m); return a && VERB[a.act] ? a : null; }
  }
  return null;
}

/** The middleware: after an acting route answered, its line — with what the answer said about how it went. */
async function middleware(req, res, next) {
  const a = req.auth?.user ? match(req) : null;
  if (!a) return next();
  // Names first: a removed machine cannot be asked its name afterwards.
  a.name = a.container ? (a.id = await containerName(a.id)) : a.id ? nameOf(a.kind, a.id) : null;
  let answer = null, failed = null;
  const json = res.json.bind(res), write = res.write.bind(res);
  res.json = body => { answer = body; return json(body); };
  res.write = (chunk, ...rest) => {   // a streamed start (services, llama.cpp) says how it ended in its last lines
    const t = String(chunk || '');
    if (/"ok"\s*:\s*false|"error"\s*:/.test(t)) failed = (/"(?:error|status)"\s*:\s*"([^"]{0,200})/.exec(t) || [])[1] || 'it said so';
    return write(chunk, ...rest);
  };
  res.on('finish', () => {
    const ok = res.statusCode < 400 && !answer?.error && answer?.ok !== false && !failed;
    const id = a.id || a.fromAnswer?.(answer);
    if (!id) return;
    note({ kind: a.kind, id, act: a.act, name: a.id ? a.name : null, ok, error: answer?.error || failed },
      { from: 'person', person: personOf(req.auth.user), via: viaOf(req) });
  });
  next();
}

/** A hub command (api-v1/commands.js) as the machine act it is, or null: the device's and the agent's road. */
function commandAct(commandId, params = {}) {
  const [group, ...rest] = String(commandId || '').split('.'), act = rest[rest.length - 1];
  if (group === 'compose') return { kind: 'stack', id: stackId(), act };
  if (group === 'docker') return params.id ? { kind: 'container', id: String(params.id), act, container: true } : null;
  if (group === 'services') return params.id ? { kind: 'service', id: String(params.id), act } : null;
  if (group === 'llamacpp') return params.id ? { kind: 'llamacpp', id: String(params.id), act } : null;
  return null;
}

/** A device's command (not the agent's: acts-agent.js names its conversation). */
async function command(commandId, params, deviceId, { ok = null, error = null } = {}) {
  const a = commandAct(commandId, params);
  if (!a || deviceId === 'agent') return null;
  if (a.container) a.id = await containerName(a.id);
  let d = null, person = null;
  try { d = require('../api-v1/devices').get(deviceId); } catch { /* no registry */ }
  try { if (d?.userId) person = personOf(require('../auth/store').userById(d.userId)); } catch { /* no accounts */ }
  return note({ ...a, ok, error }, { from: 'person', person, via: d ? `the device ${d.name}` : 'a device' });
}

/** A take-over socket opened (terminal.js, after the gate let it through): who is now at that machine's keyboard. */
function upgrade(req, who) {
  if (!/[?&]drive=1\b/.test(req.url || '')) return;
  const m = /^\/ws\/(computer|vnc)\/([^/?]+)/.exec(req.url);
  if (!m) return;
  note({ kind: m[1], id: decodeURIComponent(m[2]), act: 'take-over', ok: true }, { from: 'person', person: personOf(who?.user), via: viaOf({ auth: who }) });
}

module.exports = { middleware, command, commandAct, upgrade, note, nameOf, containerName, ROUTES, VERB, personOf };
