'use strict';

/**
 * The context Ollama actually serves a model with, against the one declared.
 *
 * ISSUES.md H-20: `contextWindow` drives compaction, the preflight, the
 * warnings and the ring — but Ollama is reached through its OpenAI-compatible
 * `/v1` shim, which takes no per-request context size. So a declared 32k
 * against a model Ollama loaded at 4096 is cut silently past 4096, and reads as
 * the model forgetting the start of its own turn. It cannot be sent; it can be
 * measured and said. From Ollama's native API:
 *   GET  /api/ps     running models, with the context each was loaded with
 *   POST /api/show   the Modelfile's num_ctx, and the model's own maximum
 *
 * check() → { model, effective, source, max, declared, mismatch, advice }.
 * Cached a minute per model: it is asked at the start of turns.
 */
const TTL = 60e3;
const _cache = new Map();   // model -> { at, r }

async function getJson(url, init = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function check(model, declared = 0, { base } = {}) {
  const key = `${model}|${declared}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.r;
  const root = base || require('./providers').ollamaBase();
  let running = null, modelfile = null, max = null;
  try {
    const ps = await getJson(`${root}/api/ps`);
    const m = (ps.models || []).find(x => x.name === model || x.model === model || String(x.name).split(':')[0] === String(model).split(':')[0]);
    if (m?.context_length) running = Number(m.context_length);
  } catch { /* Ollama not answering: nothing measured */ }
  try {
    const show = await getJson(`${root}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) });
    const n = /(?:^|\n)\s*num_ctx\s+(\d+)/.exec(show.parameters || '');
    if (n) modelfile = Number(n[1]);
    const info = show.model_info || {};
    const k = Object.keys(info).find(x => x.endsWith('.context_length'));
    if (k) max = Number(info[k]);
  } catch { /* unknown model, or no native API */ }
  const effective = running || modelfile || null;
  const source = running ? 'running' : modelfile ? 'modelfile' : null;
  const d = Number(declared) || 0;
  const mismatch = !!(effective && d && d > effective);
  const advice = mismatch
    ? `Ollama serves ${model} with a context of ${effective} tokens (${source === 'running' ? 'as loaded now' : 'its Modelfile\'s num_ctx'}), `
      + `but ${d} is declared: everything past ${effective} is cut without an error. Declare ${effective}, or raise Ollama's: `
      + `a Modelfile with "PARAMETER num_ctx ${Math.min(d, max || d)}", or OLLAMA_CONTEXT_LENGTH on the Ollama server`
      + `${max ? ` (the model supports up to ${max})` : ''}.`
    : '';
  const r = { model, effective, source, max, declared: d, mismatch, advice };
  _cache.set(key, { at: Date.now(), r });
  return r;
}

module.exports = { check };
