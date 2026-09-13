'use strict';

/**
 * Device-facing conversation with the built-in harness — an adapter over
 * `modules/harness/*`, not a second harness.
 *
 * A turn runs through `harness/agent.turn()`, so the system prompt order, the
 * safety charter and the rule that a settings proposal needs a human click are
 * the same ones the dashboard console uses. Sessions and durable memory stay in
 * `harness/memory.js`; nothing here keeps conversation state of its own.
 *
 * What differs is **where a turn goes**. The console owns one answer per request
 * (`harness/routes.js` `handleChat`), which cannot serve several devices: ask by
 * voice on a watch, lower your wrist, and the answer is gone — and the phone in
 * your pocket never knew a turn was happening. So posting a message and
 * receiving the turn are separate here. The POST answers `202 {turnId}` and the
 * turn is published on the event bus, which is already cursor-based, resumable
 * and multi-subscriber, so every client the user owns sees the same turn and one
 * that reconnects replays it from its cursor.
 *
 * Only the built-in harness is reachable this way. The 14 catalogued CLIs are
 * processes with a terminal, not an API, so a device cannot chat with them.
 */
const crypto = require('crypto');

const bus      = require('./bus');
const devices  = require('./devices');
const { hasScope } = require('./scopes');
const { ApiError } = require('./errors');

const agent    = require('../harness/agent');
const memory   = require('../harness/memory');
const settings = require('../harness/settings');

const MAX_MESSAGE      = 8000;
const MAX_REPLY        = 8000;   // carried on the done event
const MAX_TOOL_ARGS    = 300;
const MAX_TOOL_PREVIEW = 400;
const MAX_HISTORY      = 200;
/** Text deltas are coalesced into one event per this many ms. */
const DELTA_FLUSH_MS   = 150;
const DELTA_FLUSH_CHARS = 400;

/** sessionId → turnId, so two clients cannot interleave one transcript. */
const _running = new Map();

/**
 * Every device allowed to hold a conversation sees turn state, including the one
 * that asked: a turn is a thing that happened to the user, not to a device.
 */
function fanout(type, payload) {
  try {
    return bus.publishWhere(devices.list(), d => hasScope(d.scopes, 'harness:chat'), type, payload);
  } catch (e) {
    // An oversized event must not abort a turn that is otherwise fine.
    if (e.code === 'event_too_large') return [];
    throw e;
  }
}

function toOne(deviceId, type, payload) {
  try { return bus.publish(deviceId, type, payload); } catch { return null; }
}

/**
 * What the agent is told about the client that asked. Derived from the device's
 * own capability document, so a client tags itself once at pairing and never has
 * to repeat it per message — and cannot claim to be a desktop on Tuesday.
 */
function clientOf(device) {
  const caps = device.caps || {};
  return {
    id: device.id,
    name: device.name,
    kind: device.kind,
    formFactor: caps.formFactor || null,
    label: device.kind === 'agent' ? 'an agent, not a person'
      : caps.formFactor && caps.formFactor !== 'other' ? `a ${caps.formFactor}` : 'a device',
    screen: caps.screen || null,
    input: caps.input || null,
  };
}

function brief(value, max) {
  if (value === undefined || value === null) return undefined;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/* ── Sessions ─────────────────────────────────────────── */

function sessions() {
  const { sessions: list, active } = memory.listSessions();
  return { sessions: list, active };
}

function createSession(title, { activate = true } = {}) {
  const session = memory.createSession(typeof title === 'string' ? title.slice(0, 120) : undefined);
  if (activate) memory.setActive(session.id);
  return session;
}

function activate(id) {
  requireSession(id);
  return memory.setActive(id);
}

function removeSession(id) {
  requireSession(id);
  if (_running.has(id)) throw new ApiError(409, 'turn_in_flight', 'A turn is running in this conversation', { turnId: _running.get(id) });
  memory.deleteSession(id);
}

function requireSession(id) {
  const session = memory.getSession(id);
  if (!session) throw new ApiError(404, 'not_found', 'Unknown session');
  return session;
}

/**
 * One conversation, tailored for a client that draws a chat: the tool plumbing
 * a model needs is reduced to the names of the tools that ran.
 */
function transcript(id, { limit = 50 } = {}) {
  const session = requireSession(id);
  const n = Math.min(Math.max(Number(limit) || 50, 1), MAX_HISTORY);
  const rows = memory.messages(id).slice(-n).map(row => ({
    role: row.role,
    content: typeof row.content === 'string' ? row.content : '',
    // Which client this was asked from, so a shared conversation reads as one.
    ...(row.from ? { from: row.from } : {}),
    ...(row.name ? { name: row.name } : {}),
    ...(Array.isArray(row.tool_calls) && row.tool_calls.length
      ? { tools: row.tool_calls.map(tc => tc.function?.name || '(unnamed)') }
      : {}),
  }));
  return { session, messages: rows };
}

/* ── Turns ────────────────────────────────────────────── */

/**
 * Start a turn. Returns as soon as it is accepted; the answer arrives as events.
 */
function post(body, device) {
  const message = String(body?.message ?? '').trim();
  if (!message) throw new ApiError(400, 'invalid_request', 'message is required');
  if (message.length > MAX_MESSAGE) throw new ApiError(413, 'payload_too_large', `message exceeds ${MAX_MESSAGE} characters`);
  // FUTURE(phase 2): images and audio arrive as mediaId references. Refusing
  // them is honest; accepting and ignoring them would not be.
  if (body?.mediaId) throw new ApiError(400, 'unsupported', 'Media in a harness message is not implemented yet');

  const session = body?.sessionId ? requireSession(body.sessionId) : memory.activeSession();

  const inFlight = _running.get(session.id);
  if (inFlight) throw new ApiError(409, 'turn_in_flight', 'A turn is already running in this conversation', { turnId: inFlight });

  const turnId = `trn_${crypto.randomBytes(6).toString('hex')}`;
  const ctrl = new AbortController();
  _running.set(session.id, turnId);

  fanout('agent.turn', {
    turnId, sessionId: session.id, state: 'started', by: device.id,
    message: brief(message, 200),
  });

  run({ turnId, message, session, device, ctrl });   // deliberately not awaited
  return { turnId, sessionId: session.id };
}

async function run({ turnId, message, session, device, ctrl }) {
  const sessionId = session.id;
  const proposals = [];

  let buffer = '';
  let timer = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!buffer) return;
    const delta = buffer;
    buffer = '';
    // Deltas go only to the client that asked: it is the one with a screen open,
    // and a watch cannot read per-token updates it would pay for in radio time.
    toOne(device.id, 'agent.text', { turnId, sessionId, delta });
  };

  const emit = evt => {
    switch (evt.type) {
      case 'text':
        buffer += evt.text || '';
        if (buffer.length >= DELTA_FLUSH_CHARS) flush();
        else if (!timer) { timer = setTimeout(flush, DELTA_FLUSH_MS); timer.unref?.(); }
        break;
      case 'tool_call':
        flush();
        fanout('agent.tool', {
          turnId, sessionId, name: evt.name, phase: 'call', step: evt.step,
          args: brief(evt.args, MAX_TOOL_ARGS),
        });
        break;
      case 'tool_result': {
        const result = String(evt.result ?? '');
        fanout('agent.tool', {
          turnId, sessionId, name: evt.name, phase: 'result', step: evt.step,
          ok: !result.startsWith('Error:'), preview: brief(result, MAX_TOOL_PREVIEW),
        });
        break;
      }
      case 'proposal':
        // The device may see that a change is waiting; only a click applies it.
        proposals.push({
          id: evt.proposal?.id,
          reason: brief(evt.proposal?.reason, 200),
          changes: (evt.proposal?.changes || []).map(c => ({ path: c.path, to: c.to })),
        });
        break;
      default:
        break;   // 'session' tells us what we already resolved
    }
  };

  try {
    const r = await agent.turn({ message, sessionId, emit, signal: ctrl.signal, client: clientOf(device) });
    flush();
    fanout('agent.turn', {
      turnId, sessionId: r.sessionId, state: 'done', by: device.id,
      text: brief(r.text, MAX_REPLY) || '', steps: r.steps,
      ...(proposals.length ? { proposals } : {}),
    });
  } catch (e) {
    flush();
    fanout('agent.turn', {
      turnId, sessionId, state: 'failed', by: device.id,
      error: { code: e.status === 400 ? 'harness_unconfigured' : 'harness_error', message: e.message },
    });
  } finally {
    if (_running.get(sessionId) === turnId) _running.delete(sessionId);
  }
}

/** Which conversations are mid-turn, so a client can draw "typing" on arrival. */
function running() {
  return [..._running.entries()].map(([sessionId, turnId]) => ({ sessionId, turnId }));
}

/* ── Memory (read-only here; writing stays a click) ───── */

function memoryList() {
  return {
    entries: memory.memList(),
    rules: memory.rules(),
    proposals: settings.list().pending.map(p => ({
      id: p.id, createdAt: p.createdAt, reason: p.reason,
      changes: (p.changes || []).map(c => ({ path: c.path, to: c.to })),
    })),
  };
}

module.exports = {
  sessions, createSession, activate, removeSession, transcript,
  post, running, memoryList,
  MAX_MESSAGE,
};
