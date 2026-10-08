'use strict';

/**
 * DOCA's own model requests while they run (audit 2026-10-06: "I see the GPUs running something but the models don't
 * show on, and no specialists working"). Every request transport.complete() sends is here from its first byte to its
 * last, with what made it — a turn's step, a fold, an ask, a probe — and for which conversation. A local model server
 * that is busy with nothing of DOCA's in flight is busy for someone else, and model-servers.js says so: a GPU job is
 * never a mystery on DOCA's side. In memory: a restart ends every request anyway.
 */
const _now = new Map();   // id → {provider, url, model, kind, sessionId, agent, at}
let _seq = 0;

/** A request started; call the returned function when it ends, however it ends. */
function start({ provider, url, model, kind = 'ask', sessionId = null, agent = null } = {}) {
  const id = ++_seq;
  _now.set(id, { provider, url, model, kind, sessionId, agent, at: new Date().toISOString() });
  const used = require('../service-life/usage').begin(url);   // a service at this address was used (its idle clock)
  return () => { _now.delete(id); used(); };
}

const list = () => [..._now.values()];

module.exports = { start, list };
