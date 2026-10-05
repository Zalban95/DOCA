'use strict';

/**
 * Retrieval: finding by meaning, not only by the words (TODO H10.2; docs/experiments/retrieval.md). An experiment
 * (`experiments.retrieval`), and only with an embedding model set (`retrieval.model`).
 *
 * Each source is a list of `{ref, text}` the caller already may read (memory entries; the conversations a person
 * may open). `refresh(source, items)` embeds what changed since last time — chunks are hashed, so an unchanged
 * entry costs nothing — and drops what is gone; `search(source, query, items)` refreshes, embeds the query and
 * ranks by cosine. Vectors live in doca.db (`embeddings`, one row per chunk and model); ranking is a scan in
 * process, which is milliseconds at a few thousand chunks — pgvector with PostgreSQL is where it goes past that.
 *
 * `hybrid(keyword, semantic)` merges a keyword ranking with this one by reciprocal rank (k = 60), so an exact word
 * still wins when the person used it, and a paraphrase is found when they did not.
 */
const crypto = require('crypto');
const db = require('../db');
const E = require('./embed');

const CHUNK = 1200, OVERLAP = 200;
const on = () => require('../experiments').on('retrieval') && !!E.settings().model;
const hash = t => crypto.createHash('sha256').update(t).digest('hex').slice(0, 24);

/** A text in overlapping pieces, cut at a paragraph or sentence end when one is near. */
function chunks(text) {
  const s = String(text || '').trim();
  if (s.length <= CHUNK) return s ? [s] : [];
  const out = [];
  for (let i = 0; i < s.length;) {
    let end = Math.min(s.length, i + CHUNK);
    if (end < s.length) {
      const cut = Math.max(s.lastIndexOf('\n\n', end), s.lastIndexOf('. ', end));
      if (cut > i + CHUNK / 2) end = cut + 1;
    }
    out.push(s.slice(i, end).trim());
    if (end >= s.length) break;
    i = Math.max(end - OVERLAP, i + 1);
  }
  return out.filter(Boolean);
}

/** Bring a source's stored chunks up to date with `items`; returns how many chunks were embedded. */
async function refresh(source, items, { model = E.settings().model, provider = E.settings().provider, signal } = {}) {
  const have = new Map((await db.all("SELECT ref, chunk, hash FROM embeddings WHERE tenant_id = 'local' AND source = ? AND model = ?", [source, model]))
    .map(r => [`${r.ref}\u0000${r.chunk}`, r.hash]));
  const want = new Map();
  for (const it of items) chunks(it.text).forEach((t, i) => want.set(`${it.ref}\u0000${i}`, { ref: String(it.ref), chunk: i, text: t, hash: hash(t) }));
  const todo = [...want.values()].filter(w => have.get(`${w.ref}\u0000${w.chunk}`) !== w.hash);
  const gone = [...have.keys()].filter(k => !want.has(k)).map(k => k.split('\u0000'));
  const vecs = todo.length ? await E.embed(todo.map(t => t.text), { provider, model }, signal) : [];
  const now = new Date().toISOString();
  await db.tx(async q => {
    for (const [ref, chunk] of gone) await q.run("DELETE FROM embeddings WHERE tenant_id = 'local' AND source = ? AND model = ? AND ref = ? AND chunk = ?", [source, model, ref, Number(chunk)]);
    for (let i = 0; i < todo.length; i++) {
      const t = todo[i], v = E.normalise(vecs[i]);
      await q.run("DELETE FROM embeddings WHERE tenant_id = 'local' AND source = ? AND model = ? AND ref = ? AND chunk = ?", [source, model, t.ref, t.chunk]);
      await q.run('INSERT INTO embeddings (source, ref, chunk, hash, text, model, dims, vec, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [source, t.ref, t.chunk, t.hash, t.text, model, v.length, E.toText(v), now]);
    }
  });
  return { embedded: todo.length, removed: gone.length, chunks: want.size };
}

/** The refs of `items` nearest to `query` in meaning, best first: [{ref, score, text}] (text: the best chunk). */
async function search(source, query, items, { limit = 8, signal } = {}) {
  const { model, provider } = E.settings();
  await refresh(source, items, { model, provider, signal });
  const [q] = await E.embed([String(query)], { provider, model }, signal);
  const qv = E.normalise(q);
  const allowed = new Set(items.map(i => String(i.ref)));
  const best = new Map();
  for (const r of await db.all("SELECT ref, text, vec FROM embeddings WHERE tenant_id = 'local' AND source = ? AND model = ?", [source, model])) {
    if (!allowed.has(r.ref)) continue;
    const score = E.dot(qv, E.fromText(r.vec));
    if (!best.has(r.ref) || best.get(r.ref).score < score) best.set(r.ref, { ref: r.ref, score, text: r.text });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Reciprocal-rank fusion of ranked ref lists (best first). */
function hybrid(...lists) {
  const score = new Map();
  for (const list of lists) list.forEach((ref, i) => score.set(ref, (score.get(ref) || 0) + 1 / (60 + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([ref]) => ref);
}

/** What the index holds, per source and model — for Settings. */
async function stats() {
  return db.all("SELECT source, model, COUNT(*) AS chunks, COUNT(DISTINCT ref) AS refs, MAX(updated_at) AS updated FROM embeddings WHERE tenant_id = 'local' GROUP BY source, model");
}

async function clear(source) {
  return db.run(`DELETE FROM embeddings WHERE tenant_id = 'local'${source ? ' AND source = ?' : ''}`, source ? [source] : []);
}

module.exports = { on, chunks, refresh, search, hybrid, stats, clear };
