'use strict';

/**
 * A reply that was all thinking (deep test B, C2): a thinking model spent the whole "Longest reply" (2048 tokens, then
 * the default) on its reasoning, stopped at the limit (`finish: length`) and wrote no answer and called no tool — an
 * empty turn with a warning. Once per step it is asked again with twice the limit, up to the model's window when one
 * is declared, and the person is told so (`warning`, kind `thinking-retry`). Still nothing, the truncation notice
 * names the setting in a sentence (fallback.truncationNotice `thinkingOnly`). A provider that refuses the larger limit
 * (its own maximum is lower) leaves the first reply standing, with a line saying why.
 */

const emptyThought = r => r?.finish === 'length' && !String(r.content || '').trim() && !(r.tool_calls || []).length;

/** `call(body)` is the step's model call; answers its reply, asked once more when it was only thinking. */
async function withRoom(call, { body, p, say, step, who }) {
  const first = await call(body);
  if (!emptyThought(first)) return first;
  const cap = Number(body.max_tokens) || Number(p?.maxTokens) || 0;
  const window = Number(p?.contextWindow) || 0;
  const more = cap ? (window ? Math.min(cap * 2, window) : cap * 2) : 0;
  if (!(more > cap)) return { ...first, thinkingOnly: true };
  const name = first.provider || who;
  say({ type: 'warning', step, kind: 'thinking-retry', text: `${name} spent all ${cap} tokens of its reply thinking and wrote no answer `
    + `("Longest reply", harness.config.doca.maxTokens) — asking it once more with room for ${more}.` });
  try {
    const again = await call({ ...body, max_tokens: more });
    return emptyThought(again) ? { ...again, thinkingOnly: true, tried: more } : again;
  } catch (e) {
    if (Number(e?.status) !== 400) throw e;
    say({ type: 'warning', step, kind: 'thinking-retry', text: `${name} refused ${more} tokens for a reply (its own maximum is lower), so the reply stays as it was.` });
    return { ...first, thinkingOnly: true };
  }
}

module.exports = { withRoom, emptyThought };
