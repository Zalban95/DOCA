'use strict';

/**
 * The agents' machine acts, written down with the conversation that made them (acts.js is the people's): from a turn's
 * own events — a `tool_call`, then its `tool_result` — for the tools that start, stop or remove a machine:
 *   hub_command run    a hub command (api-v1/commands.js: the stack, a container, a service, a llama.cpp server)
 *   mcp_connect        connecting or disconnecting an MCP server
 *   computer           making, starting, stopping or removing an agents' computer
 * The line says which conversation (`via`, and its `sessionId` so Chronicle opens it) and on whose behalf (its person,
 * session-access.ownerOf), and whether it worked — a refused or failed call is written as such, never as done.
 */
const _pending = new Map();   // `${sessionId}|${tool}` → [act waiting for its result]

function actOf(name, args = {}) {
  if (name === 'hub_command' && args.action === 'run') return require('./acts').commandAct(args.id, args.params || {});
  if (name === 'mcp_connect' && args.server && ['start', 'stop'].includes(args.action)) return { kind: 'mcp', id: String(args.server), act: args.action };
  if (name === 'computer' && ['create', 'start', 'stop', 'remove'].includes(args.action))
    return { kind: 'computer', id: args.action === 'create' ? null : String(args.id || ''), act: args.action };
  return null;
}

const failed = result => /^(Error|Refused|Not run)\b/.test(String(result || '').trim());

function by(sessionId) {
  let person = null, title = null;
  try {
    const id = require('../harness/session-access').ownerOf(sessionId);
    if (id) person = require('./acts').personOf(require('../auth/store').userById(id));
  } catch { /* no accounts */ }
  try { title = require('../harness/memory').getSession(sessionId)?.title || null; } catch { /* no session */ }
  return { from: 'agent', person, sessionId, via: `the conversation ${title ? `"${title}"` : sessionId}` };
}

async function onEvent(evt) {
  if (!evt?.sessionId || !evt.name || (evt.type !== 'tool_call' && evt.type !== 'tool_result')) return;
  const key = `${evt.sessionId}|${evt.name}`;
  if (evt.type === 'tool_call') {
    let args = evt.args;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
    const a = actOf(evt.name, args || {});
    if (!a) return;
    // Queued at once (its result may come before docker answers), named while the call runs: a removed container has no name after.
    a.ready = a.container ? require('./acts').containerName(a.id).then(n => { a.id = n; }, () => {}) : null;
    _pending.set(key, [...(_pending.get(key) || []), a].slice(-10));
    return;
  }
  const queue = _pending.get(key);
  const a = queue?.shift();
  if (!queue?.length) _pending.delete(key);
  if (!a) return;
  await a.ready;
  const ok = !failed(evt.result);
  const id = a.id || /\bComputer ([a-f0-9]{6,})\b/.exec(String(evt.result || ''))?.[1];
  if (!id) return;
  require('./acts').note({ kind: a.kind, act: a.act, id, ok, error: ok ? null : String(evt.result).slice(0, 200) }, by(evt.sessionId));
}

let _on = false;
/** Listen to every turn's events, once (machines/index.js mount). */
function listen() {
  if (_on) return;
  _on = true;
  require('../harness/agent').events.on('event', e => { onEvent(e).catch(() => {}); });
}

module.exports = { listen, onEvent, actOf };
