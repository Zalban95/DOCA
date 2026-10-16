'use strict';

/**
 * Clearing old tool results under token pressure (TODO.md, "Where this harness
 * stands…" §5: "no pruning of stale tool results and no context editing").
 *
 * The fold summarises *earlier turns* and never the one in progress (memory.js,
 * pendingFold) — deliberately, because summarising the code the agent is
 * iterating on loses it. That left one ceiling: a single turn that reads three
 * large files carries all three to the end, and a turn larger than the window
 * is refused by the provider. This is the valve for that case, and it is what
 * the labs' harnesses do: a result the model has already acted on is replaced,
 * in what is *sent*, by one line saying it was there and how to get it back.
 *
 * - **Two triggers.** `compactReason`, only after `foldSummary` found nothing
 *   earlier to fold; and first of all the per-step ceiling (`stepTokens`,
 *   turn/step-ceiling.js), which clears before it folds.
 * - **Never what the model has not seen.** Results after the last assistant row
 *   arrived this step and are never cleared, however many there are.
 * - **Nothing is lost.** The stub names the file holding the whole result
 *   (messages.js spillTool) and says to read_file it; a long argument of an old
 *   call (a file written, a script run) is cleared the same way, as valid JSON.
 * - **The newest `KEEP` results stay word for word**, and nothing under
 *   `MIN_CHARS` is touched: a short result costs less than the line replacing it.
 * - **One persisted mark, `clearedThrough`, only ever moving forward.** Rows
 *   before it are cleared in every later request, so the prompt is byte-stable
 *   between clears and the provider's prefix cache breaks once per clear rather
 *   than on every step (ISSUES.md H-9 is the cost of getting that wrong).
 * - **The transcript is untouched.** The stored row, the panel's view and the
 *   download keep every byte; only the model's copy is shortened. The call and
 *   its result row both stay, so no pair is broken (`pairedRows`).
 */

const memory = require('../memory');

const KEEP = 3;
const MIN_CHARS = 1200;

const ARG_CHARS = 400;   // an argument value longer than this, in an old call over MIN_CHARS, is left out on re-sends
const longArgs = r => r?.role === 'assistant' && (r.tool_calls || []).some(c => String(c.function?.arguments || '').length > MIN_CHARS);
const clearable = r => (r?.role === 'tool' && String(r.content || '').length > MIN_CHARS) || longArgs(r);

/**
 * Move the mark so that every clearable result except the newest KEEP is
 * cleared. Returns how many results this newly clears (0: nothing to do).
 */
function clearOld(sessionId) {
  const rows = memory.messages(sessionId);
  const seen = rows.map(r => r.role).lastIndexOf('assistant');   // after it: this step's results, not yet read
  const at = rows.map((r, i) => (clearable(r) && i < seen ? i : -1)).filter(i => i >= 0);
  if (at.length <= KEEP) return 0;
  const through = at[at.length - KEEP];
  const prev = Number(memory.getSession(sessionId)?.clearedThrough) || 0;
  if (through <= prev) return 0;
  memory.updateSession(sessionId, { clearedThrough: through });
  return at.filter(i => i >= prev && i < through).length;
}

/**
 * The window's rows as the model is sent them. `offset` is the absolute index
 * of rows[0] (memory.window's `folded`); rows themselves are never mutated.
 */
function view(rows, offset, clearedThrough, sessionId) {
  const mark = Number(clearedThrough) || 0;
  if (!mark) return rows;
  return rows.map((r, j) => {
    if (!(offset + j < mark && clearable(r))) return r;
    if (r.role === 'assistant') return { ...r, tool_calls: r.tool_calls.map(shortCall) };
    if (String(r.content || '').length <= MIN_CHARS) return r;
    const file = require('./messages').spillTool(sessionId, r);
    return { ...r, content: `[cleared to save context: this ${r.name || 'tool'} result (${String(r.content).length} characters, `
      + `${String(r.content).split('\n').length} lines) was used earlier and is left out of what you are sent. Nothing is lost: `
      + `the whole result is in ${file} — read_file it (offset, maxLength) if you need it again.]`, cleared: true };
  });
}

/** An old call with its long argument values left out, still valid JSON; a call that does not parse is sent as it was. */
function shortCall(c) {
  const raw = String(c.function?.arguments || '');
  if (raw.length <= MIN_CHARS) return c;
  let args;
  try { args = JSON.parse(raw); } catch { return c; }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return c;
  const out = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'string' && v.length > ARG_CHARS
    ? `[left out to save context: ${v.length} characters you sent here earlier — what the call did is unchanged; the transcript keeps them]`
    : v]));
  return { ...c, function: { ...c.function, arguments: JSON.stringify(out) } };
}

module.exports = { clearOld, view, KEEP, MIN_CHARS, ARG_CHARS };
