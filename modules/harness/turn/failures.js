'use strict';

/**
 * A failed tool call as a type, not only a sentence (TODO.md, "Failure needs a
 * structured shape"), and the one policy that reads it.
 *
 * The prose stays exactly what the model reads. Beside it a failure gets a
 * `kind` and whether trying again can help, kept on the transcript row
 * (`failure`) and on the live `tool_result` event, so a client or a later
 * reader can reason about it without parsing English.
 *
 * The policy: the same call failing the same way again in one turn is a loop,
 * not a retry. The second identical failure is told so; the third is told to
 * stop and report itself blocked. Counted per turn (keyed on the turn's abort
 * signal), so a new turn starts clean.
 */
const KINDS = [
  ['refused',     false, /^(Refused by the user|Not run:)/],
  ['bad-args',    true,  /^Error: could not parse the arguments as JSON|^Error: .*\b(required|must be|is not a valid|invalid|expected)\b/i],
  ['unavailable', false, /^Error: (the "[^"]+" tool is switched off|no tool named|no MCP tool named|the "[^"]+" MCP server is not running)/],
  ['not-found',   true,  /^Error: .*\b(ENOENT|no such file|not found|does not exist|Nothing at|No [a-z]+ (called|named))\b/i],
  ['permission',  false, /^Error: .*\b(EACCES|EPERM|permission denied|outside the allowed roots|not allowed|forbidden|refused)\b/i],
  ['timeout',     true,  /^(Error: .*\b(timed? ?out|gave up after|ETIMEDOUT)\b|Timed out after)/i],
  ['network',     true,  /^Error: .*\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|fetch failed|socket hang up)\b/i],
  ['tool-error',  true,  /^Error:/],
];

/** { kind, retryable } for a failed result, or null for a success. */
function classify(result) {
  const s = String(result ?? '');
  for (const [kind, retryable, re] of KINDS) if (re.test(s)) return { kind, retryable };
  return null;
}

/** `{ failure }` for a transcript row or event, or nothing. */
function typed(result) {
  const f = classify(result);
  return f ? { failure: f } : {};
}

const turns = new WeakMap();   // turn signal → Map(call key → count)

/** The result the model reads, with the loop policy applied to a repeated failure. */
function note(signal, name, args, result) {
  const f = classify(result);
  if (!f || !signal) return result;
  if (!turns.has(signal)) turns.set(signal, new Map());
  const seen = turns.get(signal);
  let key;
  try { key = `${name}\u0000${JSON.stringify(args ?? {})}\u0000${f.kind}`; } catch { return result; }
  const n = (seen.get(key) || 0) + 1;
  seen.set(key, n);
  if (n === 2) return `${result}\n[This exact call has now failed the same way twice in this turn (${f.kind}). `
    + 'Change something before calling again — the arguments, the tool, or the approach.]';
  if (n >= 3) return `${result}\n[Failed the same way ${n} times in this turn (${f.kind}). Do not call it again as it is: `
    + 'say what you were trying to do, what failed, and that you are blocked, unless another route is plainly open.]';
  return result;
}

module.exports = { classify, typed, note };
