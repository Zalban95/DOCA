'use strict';

/**
 * A chat's message over an SSE response, busy or not (inbox.js): a turn of its
 * own when the conversation is free; otherwise "queued", then "queued_read"
 * when the running turn takes it, or "queued_started" and the turn it starts.
 * The panel's console, the Projects chat and the floating chat all send this way.
 *
 * @returns {Promise<object|null>} the turn's result, or null when it was read by
 *   another turn (whose stream carries the answer) or its sender went away
 */
async function sendStreamed(opts, { res, emit }) {
  const agent = require('./agent');
  // Settled once: by the sender going away, by another turn reading it, or by the turn it starts. A failure after the
  // sender left is logged, never handed to a promise nobody awaits — an unhandled rejection exits the whole process
  // (deep test A, 2026-10-08: a queued message whose sender had gone, then a budget refusal, took DOCA down).
  let done = false, resolve, reject;
  const settled = new Promise((y, n) => { resolve = y; reject = n; });
  const settle = v => { if (!done) { done = true; resolve(v); } };
  const fail = e => {
    if (!done) { done = true; reject(e); return; }
    console.error(`[harness] a queued message's turn failed after its sender left: ${e?.message || e}`);   // the turn records its own failure too
  };
  res.on('close', () => settle(null));
  const r = agent.send(opts, {
    onRead: () => { emit({ type: 'queued_read', id: r.id }); settle(null); },
    start: () => {
      emit({ type: 'queued_started', id: r.id });
      const own = new AbortController();
      if (!res.destroyed) res.on('close', () => own.abort());
      // A sender that went away is not a reason to drop what they wrote: the turn runs without a listener.
      return agent.turn({ ...opts, signal: own.signal }).then(settle, fail);
    },
  });
  if (!r.queued) return r;
  emit({ type: 'queued', id: r.id, position: r.position, sessionId: r.sessionId });
  return settled;
}

module.exports = { sendStreamed };
