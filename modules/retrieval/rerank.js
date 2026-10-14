'use strict';

/**
 * Finding by meaning, made better (experiment `retrievalRerank`; docs/experiments/retrieval-rerank.md). Two steps
 * on top of retrieval's keyword + meaning merge, each skipped when what it needs is not set:
 *
 * 1. Rewordings: assistant mode's quick model (`assistant.model`, asked the way the triage asks it) writes two or
 *    three other ways to say the question; each is searched like the question and every ranking is merged by
 *    reciprocal rank. No quick model, no rewordings.
 * 2. A reranker: the merged top `TOP_N` is read again by the owner's reranking model through the OpenAI-compatible
 *    `POST <baseUrl>/rerank` (`retrieval.rerankProvider` / `.rerankModel` — llama.cpp's server, vLLM, Jina, Cohere's
 *    shape) and put in its order. No reranking model, no rerank; when it fails, the merged order stands and the
 *    search says so in one line, as a failed embedding does.
 *
 * Only what the caller already may read is reworded, searched and reranked: the sources hand in their own lists.
 */
const schema = () => require('../settings-schema');

const TOP_N = 20;
const on = () => require('../experiments').on('retrievalRerank');
const settings = () => ({ provider: schema().value('retrieval.rerankProvider') || schema().value('retrieval.provider'), model: schema().value('retrieval.rerankModel') });

const REWORD_PROMPT = 'You help a search find what a person means. Given their question, write three other ways to ask '
  + 'it — other words, synonyms, the likely name of the thing — one per line, nothing else: no numbers, no quotes.';

/** Up to three rewordings of `query` from the quick model, or [] when none is set; a failure is a note. */
async function rewordings(query, { person, signal } = {}) {
  const model = schema().value('assistant.model');
  if (!model) return { words: [], note: null };
  const provider = schema().value('assistant.provider') || require('../harness/turn/params').params().provider;
  try {
    const reply = await require('../harness/turn/transport').ask({ system: REWORD_PROMPT, user: String(query).slice(0, 500), provider, model, person,
      temperature: 0.3, signal: signal || AbortSignal.timeout(20e3) });
    const seen = new Set([String(query).trim().toLowerCase()]);
    const words = String(reply).split('\n').map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["']|["']$/g, '').trim())
      .filter(l => l && l.length <= 300 && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase())).slice(0, 3);
    return { words, note: null };
  } catch (e) { return { words: [], note: `(no rewordings: ${e.message})` }; }
}

/** `docs` ([{ref, text}], best first) in the reranker's order; null when no reranking model is set. Throws on failure. */
async function rerank(query, docs, { signal } = {}) {
  const { provider, model } = settings();
  if (!model || !docs.length) return null;
  const ep = require('../harness/providers').endpoint(provider);
  let r;
  try {
    r = await fetch(`${ep.baseUrl}/rerank`, { method: 'POST', signal: signal || AbortSignal.timeout(30e3),
      headers: { 'Content-Type': 'application/json', ...(ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {}) },
      body: JSON.stringify({ model, query: String(query), documents: docs.map(d => String(d.text || d.ref)), top_n: docs.length }) });
  } catch (e) { throw new Error(`${ep.label}: cannot reach ${ep.baseUrl}/rerank (${e.name === 'TimeoutError' ? 'no answer in time' : e.message})`); }
  const j = await r.json().catch(() => ({}));
  const rows = Array.isArray(j.results) ? j.results : Array.isArray(j.data) ? j.data : null;
  if (!r.ok || !rows) {
    const why = j.error?.message || j.error || `HTTP ${r.status}`;
    throw new Error(`${ep.label} / ${model}: ${typeof why === 'string' ? why : JSON.stringify(why)}`);
  }
  const score = d => Number(d.relevance_score ?? d.score ?? 0);
  const order = [...rows].filter(d => Number.isInteger(d.index) && docs[d.index]).sort((a, b) => score(b) - score(a)).map(d => docs[d.index].ref);
  // What the reranker left out keeps its merged place after what it ranked.
  return [...new Set([...order, ...docs.map(d => d.ref)])];
}

/**
 * The merged ranking, improved: `lists` are the question's own rankings (ref lists, best first), `search(q)` returns
 * the same lists for a rewording, `textOf(ref)` the text a reranker reads. Returns { order, notes }.
 */
async function improve(query, { lists, search, textOf, person, signal }) {
  const R = require('./index');
  const notes = [];
  const all = [...lists];
  const { words, note } = await rewordings(query, { person, signal });
  if (note) notes.push(note);
  for (const w of words) all.push(...await search(w));
  let order = R.hybrid(...all);
  try {
    const head = order.slice(0, TOP_N);
    const ranked = await rerank(query, head.map(ref => ({ ref, text: textOf(ref) })), { signal });
    if (ranked) order = [...ranked, ...order.slice(TOP_N)];
  } catch (e) { notes.push(`(not reranked, kept the merged order: ${e.message})`); }
  return { order, notes, rewordings: words };
}

module.exports = { on, settings, rewordings, rerank, improve, TOP_N };
