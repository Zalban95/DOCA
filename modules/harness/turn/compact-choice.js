'use strict';

/**
 * A conversation's own compaction (asked 2026-10-09: "autocompact in a setting in the same chat"). The harness's
 * `summarizeAfter`, `compactAt` and `compactTokens` decide when older messages fold into a summary for every
 * conversation; one chat may say otherwise, kept on the session as `compact`:
 *
 *   { off: true }                 nothing folds early in this chat (the history cap still applies)
 *   { at: 50 }                    fold at this % of the window (compactAt), not past the harness's compactTokens
 *   { after: 80 }                 fold after this many messages (summarizeAfter)
 *
 * Applied to the turn's own copy of the parameters, with the model choice (turn/choice.js) — the saved harness
 * settings are never changed — so the turn, the ring (budget.context) and the badge read the same fold point.
 * `now()` folds at once, everything before the last request (the "Compact now" button and `/compact`).
 */
const memory = require('../memory');
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

/** The parameters with the chat's compaction applied. */
function apply(p, sessionId) {
  let c = null;
  try { c = memory.getSession(sessionId || memory.activeSession()?.id)?.compact; } catch { /* no session yet */ }
  if (!c) return p;
  if (c.off) return { ...p, summarizeAfter: 0, compactOff: true, _compact: c };
  return { ...p, ...(c.at ? { compactAt: c.at, compactTokens: 0 } : {}), ...(c.after ? { summarizeAfter: c.after } : {}), _compact: c };
}

/** Set (or clear, with null or {}) a chat's compaction. */
function set(sessionId, v) {
  if (!memory.getSession(sessionId)) throw bad('Unknown conversation', 404);
  if (v == null || (typeof v === 'object' && !Object.keys(v).length)) { memory.updateSession(sessionId, { compact: null }); return null; }
  if (typeof v !== 'object') throw bad('compact is {off}, {at: percent}, {after: messages} or null.');
  let c;
  if (v.off === true) c = { off: true };
  else {
    const at = v.at == null || v.at === '' ? null : Number(v.at), after = v.after == null || v.after === '' ? null : Number(v.after);
    if (at !== null && !(Number.isInteger(at) && at >= 10 && at <= 95)) throw bad('Fold at a whole percent of the window, 10 to 95.');
    if (after !== null && !(Number.isInteger(after) && after >= 8 && after <= 2000)) throw bad('Fold after a whole number of messages, 8 to 2000.');
    c = { ...(at ? { at } : {}), ...(after ? { after } : {}) };
    if (!Object.keys(c).length) c = null;
  }
  memory.updateSession(sessionId, { compact: c });
  return c;
}

/** Fold now: every earlier exchange becomes the summary; the last request and its answer stay as written. */
async function now(sessionId, person = null) {
  const session = memory.getSession(sessionId);
  if (!session) throw bad('Unknown conversation', 404);
  if (require('./lifecycle').isRunning(sessionId)) throw bad('This conversation is working: compact it when the turn has ended.', 409);
  // The summary is a model call for this person: only a model allotted to them (auth/allot.js), as a turn's fold is.
  const p = require('../../auth/allot').narrowModel(require('./choice').apply(require('./params').params(), sessionId), person);
  const ep = require('../providers').endpoint(p.provider);
  const before = session.summarizedThrough || 0;
  await require('./summary').foldSummary({ session, p, ep, force: true });
  const after = memory.getSession(sessionId).summarizedThrough || 0;
  return { folded: after - before, text: after > before
    ? `Compacted: ${after - before} earlier messages are now the summary this chat keeps; the last exchange stays as written.`
    : 'Nothing to compact yet: there is no earlier exchange before the last one (or the model did not answer the summary).' };
}

module.exports = { apply, set, now };
