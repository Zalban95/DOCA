'use strict';

/**
 * Text, pictures and sound to vectors for the Library (docs/experiments/library.md). Two dialects, because the
 * endpoints differ in what they take:
 *
 *   ollama  POST <ollama>/api/embed, `input` a list whose items are a string or a map {text, image, audio} with the
 *           media base64 — what Ollama's own type says (api/types.go EmbedRequest), and the only shape that takes a
 *           picture or sound today. Images PNG/JPEG/GIF/WebP, audio WAV/Ogg; video is not taken (frames instead).
 *   openai  POST <baseUrl>/embeddings with strings: text only, so a picture or a sound is not indexed and says so.
 *
 * The prefixes are the model card's own (EmbeddingGemma 2's config_sentence_transformers.json): a query and a document
 * are embedded differently, and a model that names none gets none — nothing is guessed for another model.
 */
const BATCH_TEXT = 16, BATCH_MEDIA = 4;

const PREFIXES = [
  { match: /embeddinggemma/i, query: 'task: search result | query: ', doc: title => `title: ${String(title || 'none').replace(/\s+/g, ' ').slice(0, 120)} | text: ` },
];
const prefixOf = model => PREFIXES.find(p => p.match.test(model || '')) || { query: '', doc: () => '' };

function settings() {
  const v = k => require('../settings-schema').value(`library.${k}`);
  return { provider: v('provider'), model: v('model'), dialect: v('dialect') };
}

/** Where the dialect's route is: Ollama's own API sits beside its /v1. */
function route({ provider, dialect }) {
  const ep = require('../harness/providers').endpoint(provider);
  const base = dialect === 'ollama' ? ep.baseUrl.replace(/\/v1$/, '') : ep.baseUrl;
  return { ep, url: dialect === 'ollama' ? `${base}/api/embed` : `${base}/embeddings` };
}

const media = it => !!(it.image || it.audio);

/**
 * Vectors for `items` ({text} | {image: Buffer} | {audio: Buffer}), in order; null for an item this dialect does not
 * take. Throws with the provider's own words when it refuses.
 */
async function embed(items, cfg = settings(), signal) {
  if (!cfg.model) throw Object.assign(new Error('No embedding model is set for the Library (Field → Models → Library).'), { status: 409 });
  const { ep, url } = route(cfg);
  const out = new Array(items.length).fill(null);
  const idx = items.map((it, i) => i).filter(i => cfg.dialect === 'ollama' || !media(items[i]));
  for (let at = 0; at < idx.length;) {
    const size = media(items[idx[at]]) ? BATCH_MEDIA : BATCH_TEXT;
    const part = idx.slice(at, at + size);
    at += size;
    const input = part.map(i => {
      const it = items[i];
      if (cfg.dialect !== 'ollama') return String(it.text || '');
      if (!media(it)) return String(it.text || '');
      return { ...(it.text ? { text: it.text } : {}), ...(it.image ? { image: it.image.toString('base64') } : {}), ...(it.audio ? { audio: it.audio.toString('base64') } : {}) };
    });
    let r;
    try {
      r = await fetch(url, { method: 'POST', signal: signal || AbortSignal.timeout(300000),
        headers: { 'Content-Type': 'application/json', ...(ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {}) },
        body: JSON.stringify({ model: cfg.model, input }) });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw Object.assign(new Error(`${ep.label}: cannot reach ${url} (${e.name === 'TimeoutError' ? 'no answer in time' : e.message})`), { status: 502 });
    }
    const j = await r.json().catch(() => ({}));
    const vecs = cfg.dialect === 'ollama' ? j.embeddings : Array.isArray(j.data) ? [...j.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(d => d.embedding) : null;
    if (!r.ok || !Array.isArray(vecs) || vecs.length !== part.length) {
      const why = j.error?.message || j.error || `HTTP ${r.status}`;
      throw Object.assign(new Error(`${ep.label} / ${cfg.model}: ${typeof why === 'string' ? why : JSON.stringify(why)}`), { status: 502 });
    }
    part.forEach((i, k) => { out[i] = Float32Array.from(vecs[k]); });
  }
  return out;
}

/** The query's vector, with the card's query prefix. */
async function query(text, cfg = settings(), signal) {
  const [v] = await embed([{ text: prefixOf(cfg.model).query + String(text) }], cfg, signal);
  return v;
}

/** A document piece's text, with the card's document prefix (the file's name as its title). */
const docText = (model, title, text) => prefixOf(model).doc(title) + String(text);

module.exports = { embed, query, docText, settings, route, prefixOf, PREFIXES };
