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
  let settle;
  const settled = new Promise(r => { settle = r; });
  res.on('close', () => settle(null));
  const r = agent.send(opts, {
    onRead: () => { emit({ type: 'queued_read', id: r.id }); settle(null); },
    start: () => {
      emit({ type: 'queued_started', id: r.id });
      const own = new AbortController();
      if (!res.destroyed) res.on('close', () => own.abort());
      // A sender that went away is not a reason to drop what they wrote: the turn runs without a listener.
      return agent.turn({ ...opts, signal: own.signal }).then(settle, e => { settle(Promise.reject(e)); });
    },
  });
  if (!r.queued) return r;
  emit({ type: 'queued', id: r.id, position: r.position, sessionId: r.sessionId });
  return settled;
}

module.exports = { sendStreamed };
