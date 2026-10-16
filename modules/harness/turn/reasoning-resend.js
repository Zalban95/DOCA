'use strict';

/**
 * A thinking model's own reasoning, as it is re-sent (lean context; AGENTS.md "Lean context per step").
 *
 * DeepSeek's thinking mode wants `reasoning_content` passed back on every assistant message of a conversation that
 * carries tools (ISSUES.md H-10), so messages.js echoes each stored row's reasoning to the provider that wrote it. That
 * echo was the whole of what broke the per-step ceiling on long turns. Task B of the test of 2026-10-16 (a 44-step craft
 * turn): one step thought for 168k tokens (526,577 characters), and that row — with 200k characters of other steps'
 * reasoning — went back on every later step: 217k tokens a step on average, 278k at most, while every tool result was
 * small and the ceiling had nothing it could clear. The mastermind on another provider was sent the same transcript
 * without the echo at 48–56k.
 *
 * So, with lean context on (`resultChars`):
 *   · reasoning over `resendChars` is sent as head + tail with the file holding all of it — decided by the row alone,
 *     so the form never changes from one step to the next and the prefix cache follows it;
 *   · under the ceiling's pressure (clear-results.js), an older row's reasoning is cleared to one line naming the file.
 * The field is always still there (the provider asks for it, not for its length), the stored row keeps every
 * character, and the model is told where the rest is — nothing is lost.
 */

const fs = require('fs');
const path = require('path');
const store = require('../../store');

/** Write a row's whole reasoning where read_file finds it; the same file for the same row. */
function spill(sessionId, row) {
  const dir = store.dir(path.join('harness/tool-results', sessionId || 'anon'));
  const at = String(row.at || 'row').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 48);
  const file = path.join(dir, `${at}-thinking.txt`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, String(row.reasoning?.text ?? ''), 'utf8');
  return file;
}

/** The reasoning text to echo for `row`: whole when short or when lean context is off, else head + tail + its file. */
function text(row, { sessionId, resendChars } = {}) {
  const s = String(row.reasoning?.text ?? '');
  if (!(resendChars > 0) || s.length <= resendChars) return s;
  const head = Math.floor(resendChars * 0.6), tail = Math.floor(resendChars * 0.35);
  const file = spill(sessionId, row);
  return `${s.slice(0, head)}\n… [your earlier thinking, shortened to save context: ${s.length} characters in ${file}; `
    + `shown: the first ${head} and the last ${tail}. read_file it (offset, maxLength) if you need the rest]\n${s.slice(-tail)}`;
}

/** One line in place of an older row's reasoning once the ceiling cleared it. */
function cleared(row, sessionId) {
  const file = spill(sessionId, row);
  return `[your earlier thinking for this step (${String(row.reasoning?.text ?? '').length} characters) is left out to save `
    + `context. Nothing is lost: it is in ${file} — read_file it if you need it again.]`;
}

/** Whether a row's reasoning is long enough for clearing to be worth a line. */
const long = (row, min) => row?.role === 'assistant' && String(row.reasoning?.text ?? '').length > min;

module.exports = { spill, text, cleared, long };
