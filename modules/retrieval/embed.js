'use strict';

/**
 * Text to vectors through the owner's provider (TODO H10.2): the OpenAI-compatible `POST <baseUrl>/embeddings`,
 * which Ollama (`nomic-embed-text`, `bge-m3`…), llama.cpp's server, vLLM, OpenAI and most hosted providers answer.
 * Which provider and model is `retrieval.provider` / `retrieval.model`; no model means retrieval is off, whatever
 * the experiment switch says — nothing is guessed.
 */
const schema = () => require('../settings-schema');

const BATCH = 32;

function settings() {
  return { provider: schema().value('retrieval.provider'), model: schema().value('retrieval.model') };
}

/** Float32Array per text, in order. Throws with the provider's own words when it refuses. */
async function embed(texts, { provider, model } = settings(), signal) {
  if (!model) throw Object.assign(new Error('No embedding model is set (Settings → Harness → Retrieval).'), { status: 409 });
  const ep = require('../harness/providers').endpoint(provider);
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const input = texts.slice(i, i + BATCH);
    let r;
    try {
      r = await fetch(`${ep.baseUrl}/embeddings`, { method: 'POST', signal: signal || AbortSignal.timeout(120000),
        headers: { 'Content-Type': 'application/json', ...(ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {}) },
        body: JSON.stringify({ model, input }) });
    } catch (e) { throw Object.assign(new Error(`${ep.label}: cannot reach ${ep.baseUrl}/embeddings (${e.name === 'TimeoutError' ? 'no answer in time' : e.message})`), { status: 502 }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(j.data)) {
      const why = j.error?.message || j.error || `HTTP ${r.status}`;
      throw Object.assign(new Error(`${ep.label} / ${model}: ${typeof why === 'string' ? why : JSON.stringify(why)}`), { status: 502 });
    }
    for (const d of [...j.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) out.push(Float32Array.from(d.embedding));
  }
  return out;
}

/** Cosine similarity; the vectors are normalised once, when stored. */
function normalise(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map(x => x / n);
}
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i];
  return s;
}

const toText = v => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
// Copied out of the Buffer: its slice of the pool need not start on a 4-byte boundary, which Float32Array requires.
const fromText = s => new Float32Array(Uint8Array.from(Buffer.from(s, 'base64')).buffer);

module.exports = { embed, settings, normalise, dot, toText, fromText };
