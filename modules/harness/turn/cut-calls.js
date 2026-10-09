'use strict';

/**
 * A tool call cut off by the reply limit (deep test A, #2): a local model's `shell` call stopped at "Longest reply"
 * mid-argument — `{"command":"mkdir -p ~/work/long && cd ~/work/long` with no closing quote. It used to be stored as
 * sent, and replayed on every later request of that conversation; llama.cpp parses every earlier call and answered 500
 * ("Failed to parse tool call arguments as JSON") to each, so the conversation was dead for good.
 *
 * So a call whose arguments do not parse is never stored as it came: `seal()` swaps its arguments for `{}` and marks
 * it, and its result row says it was cut and did not run (tool-calls.js) — a whole pair the next request can carry.
 * `repair()` does the same for a call already stored, so a conversation broken before this heals on its next request.
 * The step itself is asked once more with more room first (turn/think-retry.js).
 */

/** Arguments a provider can parse again: empty (no arguments) or JSON. */
function parses(args) {
  if (args === undefined || args === null || args === '') return true;
  if (typeof args !== 'string') return true;
  try { JSON.parse(args); return true; } catch { return false; }
}

/** The calls in a reply whose arguments were cut short. */
const cutIn = reply => (reply?.tool_calls || []).filter(c => !parses(c.function?.arguments));

/**
 * The reply with every unparseable call made whole (`{}`) and listed in `reply.cut` (the objects themselves, so the
 * step can tell them apart without a field on the call that a strict provider would refuse when it is sent back).
 */
function seal(reply, cap = 0) {
  if (!cutIn(reply).length) return reply;
  const cut = new Set();
  const tool_calls = reply.tool_calls.map(c => {
    if (parses(c.function?.arguments)) return c;
    const whole = { ...c, function: { ...c.function, arguments: '{}' } };
    cut.add(whole);
    return whole;
  });
  return { ...reply, tool_calls, cut, cutCap: cap };
}

/** The result row's words for a call that was cut and not run. */
function refusal(name, cap) {
  return `Error: the "${name}" call was cut off by the reply limit${cap ? ` (${cap} tokens, "Longest reply", harness.config.doca.maxTokens)` : ''} `
    + 'before its arguments were complete, so it did not run. Make it again with less in one call — a long file in parts, '
    + 'or a shorter command.';
}

/** A stored assistant row's calls, any unparseable one made whole — the same row every time, so a prefix cache holds. */
function repair(calls) {
  if (!calls.some(c => !parses(c.function?.arguments))) return calls;
  return calls.map(c => (parses(c.function?.arguments) ? c : { ...c, function: { ...c.function, arguments: '{}' } }));
}

module.exports = { parses, cutIn, seal, refusal, repair };
