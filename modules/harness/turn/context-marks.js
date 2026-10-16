'use strict';

/**
 * The markers lean context leaves in what is re-sent, and the refusal that keeps them out of files.
 *
 * Round 1 of the test of 2026-10-16: a `write_file` of a spec was later re-sent with its content left out
 * (clear-results.js shortCall) as "[left out to save context: 4321 characters you sent here earlier — …]"; the model,
 * writing the file again, copied that text, and the file on disk held the 127-byte marker instead of the spec. So:
 *   · a left-out argument is marked unmistakably, short, and says it is not content — and for a file write, where the
 *     content is (`argument`);
 *   · `write_file` and `replace_in_files` refuse text carrying any lean-context marker (`refusal`), as they refuse MASK
 *     into a file holding secrets: writing it would replace real work with a note about it.
 */

const OPEN = '⟦', CLOSE = '⟧';

/** The marker for a long argument value left out of a re-sent call. `args`/`tool` name where a written file's text is. */
function argument(key, value, { args = {}, tool = '' } = {}) {
  const n = String(value).length;
  const file = key === 'content' && typeof args.path === 'string' && /write|file|save/i.test(tool) ? args.path : '';
  return `${OPEN}not content: ${n} characters of "${key}" left out to save context — `
    + (file ? `the file is on disk at ${file}; read_file it, never copy this marker${CLOSE}` : `the call already ran with them${CLOSE}`);
}

// Every marker lean context writes, today's and the earlier wordings a transcript may still show the model.
const MARKS = [
  /⟦not content: \d+ characters/,
  /\[left out to save context: \d+ characters/,                                 // an argument, before round 1's fix
  /\[cleared to save context: this \S+ result \(\d+ characters/,                // a cleared result (clear-results.js view)
  /\[full output: [^\]\n]{1,400} — \d+ characters, \d+ lines; shown: the first/,   // a head + tail re-send (messages.js)
];

/** Whether text carries a lean-context marker. */
const carries = text => typeof text === 'string' && MARKS.some(re => re.test(text));

/** A sentence refusing to write `text` (null when it carries no marker). `where`: the file or the folder. */
function refusal(text, where) {
  if (!carries(text)) return null;
  return `Not written: the text for ${where} contains a marker DOCA puts in place of content it left out to save context `
    + '(⟦not content: …⟧, "[left out to save context …]", "[full output: … shown: the first …]"). Writing it would replace '
    + 'the real content with a note about it. Write the real content — read_file the file or the path the marker names '
    + 'to see what was there.';
}

module.exports = { argument, carries, refusal, MARKS };
