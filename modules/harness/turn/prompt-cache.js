'use strict';

/**
 * Cache breakpoints for the models that cache only when asked (experiment `promptCache`, docs/experiments/prompt-cache.md).
 *
 * Every step re-sends the whole prompt — the charter, the tools, the readings — which is how the first answer already
 * knows everything the agent can do (the owner's choice, 2026-10-17: the payload stays). Most providers cache that
 * repeated prefix by themselves (DeepSeek: 80–95% of a turn's prompt read from cache), but Anthropic's models cache only
 * at breakpoints the request marks: on the basics set, Opus 5.5 through OpenRouter read 0 cached tokens on every step.
 *
 * Two breakpoints, `cache_control: {type: 'ephemeral'}` on a text part (OpenRouter passes them to Anthropic as they are):
 *   - the end of the system prompt — Anthropic's order is tools, system, messages, so this caches the tools too;
 *   - the newest message — each step's prefix is the last step's prefix plus a little, so the next step reads it back.
 * A message's string content becomes one text part carrying the mark; content already in parts gets it on its last
 * text part. Nothing else in the body changes, and a model that does not need it is sent the body as it was.
 */
const MARK = { type: 'ephemeral' };
const READINGS = /^\[panel readings, not from the user\]/;   // step-request.js: the per-step readings, last and never the same

/** Whether this provider and model cache only at marked breakpoints (Anthropic's models, wherever they are served). */
function needs(ep, model) {
  const m = String(model || '').toLowerCase(), url = String(ep?.baseUrl || '').toLowerCase();
  return /(^|\/)(anthropic\/|claude)/.test(m) || /anthropic\.com/.test(url);
}

function marked(content) {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content, cache_control: MARK }] : content;
  if (!Array.isArray(content)) return content;
  const i = content.map(p => p?.type).lastIndexOf('text');
  return i < 0 ? content : content.map((p, j) => (j === i ? { ...p, cache_control: MARK } : p));
}

/** The body with its two breakpoints, when the experiment is on and the model needs them; else as it was. */
function apply(body, ep, { on = require('../../experiments').on('promptCache') } = {}) {
  if (!on || !needs(ep, body?.model) || !Array.isArray(body?.messages) || !body.messages.length) return body;
  const msgs = body.messages.slice();
  const sys = msgs.findIndex(m => m.role === 'system');
  if (sys >= 0) msgs[sys] = { ...msgs[sys], content: marked(msgs[sys].content) };
  // The newest message that stays: the per-step readings go last (step-request.js) and change every step, so a mark on
  // them was a prefix the next step never had — the Haiku task-A run read 39% from cache, the tools and system alone.
  let last = msgs.length - 1;
  while (last > sys && READINGS.test(String(typeof msgs[last].content === 'string' ? msgs[last].content : msgs[last].content?.[0]?.text || ''))) last--;
  if (last > sys) msgs[last] = { ...msgs[last], content: marked(msgs[last].content) };
  return { ...body, messages: msgs };
}

module.exports = { apply, needs };
