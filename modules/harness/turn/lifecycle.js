'use strict';

/**
 * Which conversations are mid-turn, stopping one, and the stream of every
 * turn's events — the bookkeeping around a turn, apart from the turn itself.
 */
const { EventEmitter } = require('events');

/**
 * Every turn's events, for anything that was not the caller.
 *
 * `turn()` hands its events to whoever started it, which is right for the thing
 * waiting on the answer and no use at all to a subscriber that arrived later —
 * the Logs tab, most of all, which is open across turns and belongs to nobody's
 * request. This is the same stream, published alongside. It never affects the
 * caller: `say()` delivers to `emit` first, and a listener that throws here
 * cannot reach into the turn.
 */
const events = new EventEmitter();
events.setMaxListeners(0);   // one per open Logs stream; there is no sensible cap

const running = new Map();
const isRunning = id => running.has(id);
function cancel(id) { const ctrl = running.get(id); if (ctrl) ctrl.abort(); return !!ctrl; }

/**
 * A conversation's state just changed: a turn started, or ended one way or
 * another. Devices following the harness hear about work chats this way
 * (workview.js), so what a watch shows is what is actually running.
 */
function changed(sessionId) {
  try { require('../workview').announce(sessionId); } catch { /* bookkeeping never breaks a turn */ }
}

module.exports = { events, running, isRunning, cancel, changed };
