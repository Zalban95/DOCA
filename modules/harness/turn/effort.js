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
 * naming the field costs one retry without it and a lesson (`effortField: 'none'`), never a failed turn. Which setting
 * applies to a turn — a mode's, a toggle's, the person's words — is turn/thinking.js.
 */
const LEVELS = ['off', 'low', 'medium', 'high'];
const norm = v => (LEVELS.includes(v) ? v : null);   // 'default' (and anything else): send nothing

/** Whether a turn takes assistant mode's effort and model: a call from the face, or any call when the owner says so. */
const spokenProfile = client => client?.mode === 'assistant' || (client?.mode === 'call' && require('../../settings-schema').value('assistant.calls') === true);

/** The level for this turn, and which setting it came from (for the prompt and the trace). */
function levelFor({ session, client, p } = {}) {
  if (norm(session?.effort)) return { level: session.effort, from: 'this conversation' };
  if (spokenProfile(client)) {
    const v = norm(require('../../settings-schema').value('assistant.effort'));
    if (v) return { level: v, from: client.mode === 'assistant' ? 'assistant mode (assistant.effort)' : 'live calls (assistant.effort, assistant.calls)' };
  }
  if (norm(p?.effort)) return { level: p.effort, from: 'harness.config.doca.effort' };
  return { level: null, from: null };
}

/** The provider's dialect: its contract, else a guess by address. `no_think` is never guessed: the owner names it. */
function dialect(ep, model) {
  const c = require('../contracts').forProvider(ep?.id, model);
  if (c.effortField) return c.effortField;
  const where = `${ep?.id || ''} ${ep?.baseUrl || ''}`.toLowerCase();
  if (/openrouter/.test(where)) return 'reasoning';
  if (/deepseek|anthropic|moonshot|kimi/.test(where)) return 'thinking';
  if (/:8000|vllm|sglang|qwen|dashscope/.test(where)) return 'enable_thinking';
  return 'reasoning_effort';   // OpenAI, Azure, Groq, Gemini's OpenAI surface, Ollama, LM Studio, llama.cpp
}

/**
 * What "off" is in the reasoning_effort dialect. OpenAI's gpt-5 says `minimal`; gpt-5.1 and later, Gemini, Groq and
 * llama.cpp say `none` — and llama.cpp hands the word to the model's chat template, where Qwen's raises a 500 on
 * `minimal` (found 2026-10-08 on the local server). A refusal naming the other word teaches it (`effortOff`).
 */
function offWord(ep, model) {
  const c = require('../contracts').forProvider(ep?.id, model);
  if (c.effortOff) return c.effortOff;
  return /api\.openai\.com|^openai\b/.test(`${ep?.id || ''} ${ep?.baseUrl || ''}`.toLowerCase().trim()) && !/gpt-5\.[1-9]/i.test(model || '') ? 'minimal' : 'none';
}

/** `/no_think` is a soft switch some models read in the prompt (Qwen 3): carried on the body, never sent as a field. */
const NO_THINK = Symbol('no_think');

/** The request fields that say `level` in `ep`'s dialect ({} for null or a provider that takes none). */
function fields(level, ep, model) {
  if (!level) return {};
  const d = dialect(ep, model);
  if (d === 'none') return {};
  if (d === 'reasoning') return { reasoning: level === 'off' ? { enabled: false } : { effort: level } };
  // On/off dialects: low is meant to be quick, so it is off there too; medium and high think.
  const thinks = level === 'medium' || level === 'high';
  if (d === 'no_think') return thinks ? {} : { [NO_THINK]: true };
  // Anthropic's surface wants a budget with "enabled"; the others take the switch alone.
  const budget = /anthropic/.test(`${ep?.id || ''} ${ep?.baseUrl || ''}`) ? { budget_tokens: level === 'high' ? 16000 : 4000 } : {};
  if (d === 'thinking') return { thinking: thinks ? { type: 'enabled', ...budget } : { type: 'disabled' } };
  if (d === 'enable_thinking') return { chat_template_kwargs: { enable_thinking: thinks } };
  return { reasoning_effort: level === 'off' ? offWord(ep, model) : level };
}

/** The body as sent: a `no_think` request says `/no_think` at the end of its system message. */
function dress(body) {
  if (!body?.[NO_THINK] || !Array.isArray(body.messages) || body.messages[0]?.role !== 'system') return body;
  const [sys, ...rest] = body.messages;
  return { ...body, messages: [{ ...sys, content: `${sys.content}\n\n/no_think` }, ...rest] };
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

/**
 * One retry for a refused effort, and the lesson it teaches — or null. A 400 (or a chat template's 500) that names the
 * other word for "off" is asked again with it (`effortOff`); one that names the field is asked without it
 * (`effortField: 'none'`). Either way it is paid once, then sent the way that worked.
 */
function retry(body, detail, status = 400) {
  const text = String(detail || '');
  if (status !== 400 && !(status === 500 && /reasoning|thinking|effort/i.test(text))) return null;
  const off = body.reasoning_effort;
  if (off === 'minimal' || off === 'none') {
    const other = off === 'minimal' ? 'none' : 'minimal';
    if (new RegExp(`\\b${other}\\b`).test(text) || (status === 500 && off === 'minimal'))
      return { body: { ...body, reasoning_effort: other }, lesson: { effortOff: other } };
  }
  const bare = without(body, text);
  return bare ? { body: bare, lesson: { effortField: 'none' } } : null;
}

/** The prompt's line about it, so the agent knows its own pace and how a person changes it. */
function line({ level, from }) {
  return `Thinking effort: ${level ? `${level} (from ${from})` : 'the model\'s default'}. When the person asks you to think harder, `
    + 'take your time, or be quick, set it with the `effort` tool (this conversation only) and say so in a few words.';
}

module.exports = { LEVELS, spokenProfile, levelFor, dialect, offWord, fields, dress, without, retry, KEYS, NO_THINK, line };
