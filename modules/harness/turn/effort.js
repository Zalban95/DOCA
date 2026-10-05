'use strict';

/**
 * How hard the model thinks, said once and spoken in each provider's dialect (asked 2026-10-06: assistant mode should
 * answer quickly; "think harder" should be something a person can just say).
 *
 * A level is off | low | medium | high, or null for "send nothing" (the provider's own default — what every turn did
 * before). Where it comes from, the first that says: the conversation's own (`session.effort`, set from the panel or by
 * the `effort` tool when the person asks), then assistant mode's (`assistant.effort`, a call started from the face),
 * then the harness's (`harness.config.doca.effort`). Nothing is sent when nothing says.
 *
 * Providers disagree on the field, so the dialect is part of the provider contract (harness/contracts.js
 * `effortField`): what the owner set, else what a refusal taught, else a guess from the provider's address — and a 400
 * naming the field costs one retry without it and a lesson (`effortField: 'none'`), never a failed turn.
 */
const LEVELS = ['off', 'low', 'medium', 'high'];
const norm = v => (LEVELS.includes(v) ? v : null);   // 'default' (and anything else): send nothing

/** The level for this turn, and which setting it came from (for the prompt and the trace). */
function levelFor({ session, client, p } = {}) {
  if (norm(session?.effort)) return { level: session.effort, from: 'this conversation' };
  if (client?.mode === 'assistant') {
    const v = norm(require('../../settings-schema').value('assistant.effort'));
    if (v) return { level: v, from: 'assistant mode (assistant.effort)' };
  }
  if (norm(p?.effort)) return { level: p.effort, from: 'harness.config.doca.effort' };
  return { level: null, from: null };
}

/** The provider's dialect: its contract, else a guess by address. */
function dialect(ep, model) {
  const c = require('../contracts').forProvider(ep?.id, model);
  if (c.effortField) return c.effortField;
  const where = `${ep?.id || ''} ${ep?.baseUrl || ''}`.toLowerCase();
  if (/openrouter/.test(where)) return 'reasoning';
  if (/deepseek|anthropic|moonshot|kimi/.test(where)) return 'thinking';
  if (/:8000|vllm|sglang|qwen|dashscope/.test(where)) return 'enable_thinking';
  return 'reasoning_effort';   // OpenAI, Azure, Groq, Gemini's OpenAI surface, Ollama, LM Studio, llama.cpp
}

/** The request fields that say `level` in `ep`'s dialect ({} for null or a provider that takes none). */
function fields(level, ep, model) {
  if (!level) return {};
  const d = dialect(ep, model);
  if (d === 'none') return {};
  if (d === 'reasoning') return { reasoning: level === 'off' ? { enabled: false } : { effort: level } };
  if (d === 'thinking') return { thinking: { type: level === 'off' ? 'disabled' : 'enabled' } };
  if (d === 'enable_thinking') return { chat_template_kwargs: { enable_thinking: level !== 'off' } };
  return { reasoning_effort: level === 'off' ? 'minimal' : level };
}

/** The keys fields() may add — what a refusal retry strips. */
const KEYS = ['reasoning_effort', 'reasoning', 'thinking', 'chat_template_kwargs'];

/** The body without any effort field, when a 400 names one of them; else null. */
function without(body, detail) {
  const present = KEYS.filter(k => body[k] !== undefined);
  if (!present.length) return null;
  if (!present.some(k => String(detail).includes(k.split('_')[0])) && !/reasoning|thinking|effort|unrecognized|unknown|extra/i.test(detail)) return null;
  const out = { ...body };
  for (const k of present) delete out[k];
  return out;
}

/** The prompt's line about it, so the agent knows its own pace and how a person changes it. */
function line({ level, from }) {
  return `Thinking effort: ${level ? `${level} (from ${from})` : 'the model\'s default'}. When the person asks you to think harder, `
    + 'take your time, or be quick, set it with the `effort` tool (this conversation only) and say so in a few words.';
}

module.exports = { LEVELS, levelFor, dialect, fields, without, KEYS, line };
