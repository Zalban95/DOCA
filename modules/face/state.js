'use strict';

/**
 * What the face shows (docs/design/hive.md §5; TODO H8.1): one state for the hive at a time, made from events
 * that already exist — a turn's events (agent.events), the approvals waiting, which conversations are mid-turn
 * — never from a new signal the harness has to remember to send.
 *
 *   idle · thinking · working (detail: the tool) · speaking (the answer streaming) · asking (an approval waits)
 *   · error (a turn failed; then idle)
 *
 * Seen per viewer: a person without host sees only the conversations they may open (session-access), so the
 * face on a member's screen does not show what somebody else's turn is doing.
 */
const PRIORITY = { asking: 5, error: 4, working: 3, speaking: 2, thinking: 1, idle: 0 };
const TEXT_QUIET_MS = 1500;   // an answer that stopped streaming is thinking again, until the turn ends
const ERROR_MS = 2500;

const bySession = new Map();   // sessionId -> { state, detail, at }
const listeners = new Set();
let started = false;

function put(sessionId, state, detail = null) {
  const prev = bySession.get(sessionId);
  if (prev && prev.state === state && prev.detail === detail) return;
  bySession.set(sessionId, { state, detail, at: Date.now() });
  notify();
}

function onEvent(evt) {
  const id = evt.sessionId;
  if (!id) return;
  switch (evt.type) {
    case 'session': case 'thinking': case 'tool_result': case 'waiting': return put(id, 'thinking');
    case 'text': return put(id, 'speaking');
    case 'tool_call': return put(id, 'working', String(evt.name || '').replace(/^mcp__([^_]+(?:-[^_]+)*)__/, '$1 · ').slice(0, 60));
    case 'approval':
      if (evt.state === 'asked') return put(id, 'asking', evt.tool || null);
      if (evt.state === 'answered' || evt.state === 'refused') return put(id, 'thinking');
      return;
    default:
  }
}

/** Every second: a speaking turn that went quiet thinks again; a turn that ended is idle — or an error, briefly. */
function sweep() {
  const lifecycle = require('../harness/turn/lifecycle');
  const memory = require('../harness/memory');
  let changed = false;
  for (const [id, s] of bySession) {
    if (s.state === 'error') { if (Date.now() - s.at > ERROR_MS) { bySession.delete(id); changed = true; } continue; }
    if (!lifecycle.isRunning(id)) {
      const failed = memory.getSession(id)?.state === 'failed';
      if (failed) bySession.set(id, { state: 'error', detail: null, at: Date.now() }); else bySession.delete(id);
      changed = true;
    } else if (s.state === 'speaking' && Date.now() - s.at > TEXT_QUIET_MS) { s.state = 'thinking'; changed = true; }
  }
  if (changed) notify();
}

function start() {
  if (started) return;
  started = true;
  require('../harness/agent').events.on('event', onEvent);
  setInterval(sweep, 1000).unref?.();
}

/** The state one viewer sees: the strongest among the conversations they may open, and approvals waiting for anyone they can answer. */
function viewFor(person) {
  const access = require('../harness/session-access');
  const host = !person?.id || access.isHost(person);
  const mine = id => host || access.mayUse(person, id);
  let best = { state: 'idle', detail: null, sessionId: null };
  for (const [id, s] of bySession) if (mine(id) && PRIORITY[s.state] > PRIORITY[best.state]) best = { ...s, sessionId: id };
  if (PRIORITY[best.state] < PRIORITY.asking) {
    const waiting = require('../harness/approval').pending().find(a => mine(a.sessionId));
    if (waiting) best = { state: 'asking', detail: waiting.tool || null, sessionId: waiting.sessionId };
  }
  return { state: best.state, detail: host ? best.detail : null };
}

function subscribe(fn) { start(); listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) { try { fn(); } catch { /* a closed stream */ } } }

module.exports = { start, subscribe, viewFor, onEvent, sweep, _reset: () => bySession.clear() };
