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
 * - **Only when the fold could not help.** Same trigger (`compactReason`), and
 *   only after `foldSummary` found nothing earlier to fold.
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

const clearable = r => r?.role === 'tool' && String(r.content || '').length > MIN_CHARS;

/**
 * Move the mark so that every clearable result except the newest KEEP is
 * cleared. Returns how many results this newly clears (0: nothing to do).
 */
function clearOld(sessionId) {
  const rows = memory.messages(sessionId);
  const at = rows.map((r, i) => (clearable(r) ? i : -1)).filter(i => i >= 0);
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
function view(rows, offset, clearedThrough) {
  const mark = Number(clearedThrough) || 0;
  if (!mark) return rows;
  return rows.map((r, j) => (offset + j < mark && clearable(r)
    ? { ...r, content: `[cleared to save context: this ${r.name || 'tool'} result (${String(r.content).length} characters) `
      + 'was used earlier in this turn and has been dropped from what you are sent. The user still has it. '
      + 'Run the tool again if you need it.]', cleared: true }
    : r));
}

module.exports = { clearOld, view, KEEP, MIN_CHARS };
