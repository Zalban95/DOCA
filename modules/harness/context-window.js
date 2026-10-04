'use strict';

/**
 * A model's context window, as its own server reports it (TODO.md, "Memory,
 * limits and context": `contextWindow` found rather than typed).
 *
 * The entry said there was no reliable way, and for a bare OpenAI endpoint
 * there still is not — `/v1/models` there carries no window. But most of the
 * servers this panel talks to do report one, each in its own field:
 *
 *   OpenAI-shaped /models   context_length (OpenRouter, Together, DeepInfra),
 *                           context_window (Groq), max_model_len (vLLM),
 *                           max_context_length (Mistral), top_provider.context_length
 *   LM Studio /api/v0       loaded_context_length, then max_context_length
 *   llama.cpp /props        default_generation_settings.n_ctx — what --ctx-size said
 *   Ollama                  ollama-context.js: what it loaded the model with
 *
 * What it does not do is the thing the entry rejected: a table of windows by
 * model name. A number comes back only when a server said it, with `source`
 * naming the server and the field, and otherwise `tokens` is null. It is never
 * applied by itself — the ⚙ panel offers it in the box and Save writes it —
 * because a declared window drives compaction and the preflight, and "the
 * server said" is evidence for the person, not a setting changed behind them.
 */

const TTL = 5 * 60e3;
const _cache = new Map();

// `seen.reached` is set by any answer at all, a 404 included: "it answered and
// said nothing" and "it did not answer" are different things to tell a person.
async function getJson(url, ep, seen) {
  const headers = ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {};
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
  seen.reached = true;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const n = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : null);

/** The window in one `/models` entry, and the field it came from. */
function fromModelEntry(m) {
  for (const [field, v] of [
    ['loaded_context_length', m.loaded_context_length], ['max_model_len', m.max_model_len],
    ['context_length', m.context_length], ['context_window', m.context_window],
    ['max_context_length', m.max_context_length], ['top_provider.context_length', m.top_provider?.context_length],
  ]) if (n(v)) return { tokens: n(v), field };
  return null;
}

const sameModel = (a, b) => a === b || String(a).split('/').pop() === String(b).split('/').pop();
const root = base => String(base).replace(/\/+$/, '').replace(/\/v1$/, '');

/** @returns {Promise<{ provider, model, tokens: number|null, source: string|null, reached: boolean }>} */
async function discover(provider, model) {
  const key = `${provider}|${model}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.r;
  const ep = require('./providers').endpoint(provider);
  const label = ep.label || ep.id;
  let found = null;
  const seen = { reached: false };

  if (ep.id === 'ollama') {
    const o = await require('./ollama-context').check(model, 0).catch(() => null);
    if (o?.effective || o?.max) seen.reached = true;
    if (o?.effective) found = { tokens: o.effective, source: `Ollama, ${o.source === 'running' ? 'as it loaded the model' : 'the Modelfile\'s num_ctx'}` };
  }
  if (!found) {
    try {
      const list = await getJson(`${String(ep.baseUrl).replace(/\/+$/, '')}/models`, ep, seen);
      const entry = (list.data || list.models || []).find(m => sameModel(m.id || m.name, model));
      const w = entry && fromModelEntry(entry);
      if (w) found = { tokens: w.tokens, source: `${label} /models, ${w.field}` };
    } catch { /* not answering, or no list */ }
  }
  if (!found) {
    try {
      const m = await getJson(`${root(ep.baseUrl)}/api/v0/models/${encodeURIComponent(model)}`, ep, seen);
      const w = fromModelEntry(m);
      if (w) found = { tokens: w.tokens, source: `${label} (LM Studio) /api/v0, ${w.field}` };
    } catch { /* not LM Studio */ }
  }
  if (!found) {
    try {
      const props = await getJson(`${root(ep.baseUrl)}/props`, ep, seen);
      const t = n(props?.default_generation_settings?.n_ctx) || n(props?.n_ctx);
      if (t) found = { tokens: t, source: `${label} (llama.cpp) /props, n_ctx — its --ctx-size` };
    } catch { /* not llama.cpp */ }
  }

  const r = { provider: ep.id, model, tokens: found?.tokens || null, source: found?.source || null, reached: !!(found || seen.reached) };
  _cache.set(key, { at: Date.now(), r });
  return r;
}

module.exports = { discover, fromModelEntry };
