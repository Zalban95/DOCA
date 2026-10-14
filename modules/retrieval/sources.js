'use strict';

/**
 * Where retrieval is used (docs/experiments/retrieval.md): `memory_search` and `recall_conversations`' search. Each
 * merges the keyword ranking it always had with one by meaning (index.js `hybrid`), over exactly what the keyword
 * search may see — memory entries; the conversations the person this turn acts for may open — so retrieval can
 * never find what a person could not. When the embedding call fails the keyword result is returned with a note
 * saying so: a search that quietly lost half its method is worse than one that says it did.
 *
 * With the experiment `retrievalRerank` (rerank.js) the question is also searched in rewordings and the merged
 * result read again by a reranker; off, the merge below is exactly what it was.
 */
const R = require('./index');

/** Memory entries for `query`, best first, and a note when meaning could not be searched. */
async function memory(query, limit = 8, { person = null } = {}) {
  const mem = require('../harness/memory');
  const list = mem.memList();
  const items = list.map(e => ({ ref: e.key, text: `${e.key}: ${e.value}${(e.tags || []).length ? `\ntags: ${e.tags.join(', ')}` : ''}` }));
  const notes = [];
  const lists = async (q, first) => {
    let semantic = [];
    try { semantic = items.length ? await R.search('memory', q, items, { limit: limit * 2 }) : []; }
    catch (e) { if (first) notes.push(`(searched by keyword only: ${e.message})`); }
    return [mem.memSearch(q, limit * 2).map(e => e.key), semantic.map(s => s.ref)];
  };
  const own = await lists(query, true);
  const order = await merged(query, own, { search: q => lists(q, false), textOf: k => items.find(i => i.ref === k)?.text || k, person, notes });
  const byKey = new Map(list.map(e => [e.key, e]));
  const hits = order.slice(0, limit).map(k => byKey.get(k)).filter(Boolean);
  return { hits, note: notes.join(' ') || null };
}

/** The question's own rankings merged — and, with retrievalRerank, its rewordings' too, reranked (rerank.js). */
async function merged(query, own, { search, textOf, person, notes }) {
  const rr = require('./rerank');
  if (!rr.on()) return R.hybrid(...own);
  const out = await rr.improve(query, { lists: own, search, textOf, person });
  notes.push(...out.notes);
  return out.order;
}

/** Conversations for `query`, as recall.search shapes them, with meaning searched over titles, topics and summaries. */
async function conversations(query, { limit = 6, exclude = null, person = null } = {}) {
  const recall = require('../harness/recall');
  const mem = require('../harness/memory');
  const mine = require('../harness/session-access');
  const sessions = mem.listSessions().sessions.filter(s => s.id !== exclude && mine.mayUse(person, s.id));
  const items = sessions.map(s => ({ ref: s.id, text: [s.title, (s.topics || []).join(', '), s.summary].filter(Boolean).join('\n') }))
    .filter(i => i.text.trim());
  const byId = new Map();
  const notes = [];
  const lists = async (q, first) => {
    const keyword = recall.search(q, { limit: limit * 2, exclude, person });
    for (const h of keyword) if (!byId.has(h.id)) byId.set(h.id, h);
    let semantic = [];
    try { semantic = items.length ? await R.search('conversations', q, items, { limit: limit * 2 }) : []; }
    catch (e) { if (first) notes.push(`(searched by keyword only: ${e.message})`); }
    return [keyword.map(h => h.id), semantic.map(s => s.ref)];
  };
  const own = await lists(query, true);
  const order = await merged(query, own, { search: q => lists(q, false), textOf: id => items.find(i => i.ref === id)?.text || byId.get(id)?.title || id, person, notes });
  const sById = new Map(sessions.map(s => [s.id, s]));
  const hits = order.slice(0, limit).map(id => byId.get(id) || (sById.has(id) && (s => ({
    id: s.id, title: s.title, kind: s.kind, updatedAt: s.updatedAt, archived: !!s.archivedAt, topics: s.topics || [],
    summary: s.summary ? String(s.summary).slice(0, 600) : '', matches: [] }))(sById.get(id)))).filter(Boolean);
  return { hits, note: notes.join(' ') || null };
}

module.exports = { memory, conversations };
