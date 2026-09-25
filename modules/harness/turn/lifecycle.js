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
/** Whether the turn running there is one the panel started by itself (supervisor.js). */
const isAuto = id => !!running.get(id)?.auto;
function cancel(id) { const ctrl = running.get(id); if (ctrl) ctrl.abort(); return !!ctrl; }

const busy = () => Object.assign(new Error('A turn is already running in this conversation.'), { status: 409 });

/**
 * Take a conversation for a turn.
 *
 * A turn the panel started by itself gives way to anyone else: the owner
 * speaking, or a superior sending a task, never gets "a turn is already
 * running" because of one. The automatic turn is stopped (and marked
 * `preempted`, which is not the same as being stopped — supervisor.js does not
 * treat it as a decision), and whatever it was carrying is still unread, so the
 * turn that replaces it sees it.
 */
async function claim(id, ctrl, auto = false) {
  const current = running.get(id);
  if (current) {
    if (!current.auto || auto) throw busy();
    current.preempted = true;
    current.abort();
    for (let i = 0; i < 100 && running.has(id); i++) await new Promise(r => setTimeout(r, 50));
    if (running.has(id)) throw busy();
  }
  ctrl.auto = !!auto;
  running.set(id, ctrl);
}

/**
 * A conversation's state just changed: a turn started, or ended (then `ctrl`
 * is given). Devices following the harness hear about work chats (workview.js),
 * so what a watch shows is what is actually running; and when a turn ends, the
 * supervisor decides what happens next.
 */
function changed(sessionId, ctrl = null) {
  try { require('../workview').announce(sessionId); } catch { /* bookkeeping never breaks a turn */ }
  if (ctrl) try {
    require('../supervisor').afterTurn(sessionId, {
      auto: !!ctrl.auto, preempted: !!ctrl.preempted, steps: ctrl.steps ?? null,
      stopped: ctrl.signal.aborted && !ctrl.preempted,
    });
  } catch { /* nor does deciding what comes next */ }
}

module.exports = { events, running, isRunning, isAuto, cancel, claim, changed };
