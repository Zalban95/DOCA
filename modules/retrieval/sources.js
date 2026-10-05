'use strict';

/**
 * Where retrieval is used (docs/experiments/retrieval.md): `memory_search` and `recall_conversations`' search. Each
 * merges the keyword ranking it always had with one by meaning (index.js `hybrid`), over exactly what the keyword
 * search may see — memory entries; the conversations the person this turn acts for may open — so retrieval can
 * never find what a person could not. When the embedding call fails the keyword result is returned with a note
 * saying so: a search that quietly lost half its method is worse than one that says it did.
 */
const R = require('./index');

/** Memory entries for `query`, best first, and a note when meaning could not be searched. */
async function memory(query, limit = 8) {
  const mem = require('../harness/memory');
  const keyword = mem.memSearch(query, limit * 2);
  let semantic = [], note = null;
  try {
    const items = mem.memList().map(e => ({ ref: e.key, text: `${e.key}: ${e.value}${(e.tags || []).length ? `\ntags: ${e.tags.join(', ')}` : ''}` }));
    semantic = items.length ? await R.search('memory', query, items, { limit: limit * 2 }) : [];
  } catch (e) { note = `(searched by keyword only: ${e.message})`; }
  const byKey = new Map(mem.memList().map(e => [e.key, e]));
  const hits = R.hybrid(keyword.map(e => e.key), semantic.map(s => s.ref)).slice(0, limit).map(k => byKey.get(k)).filter(Boolean);
  return { hits, note };
}

/** Conversations for `query`, as recall.search shapes them, with meaning searched over titles, topics and summaries. */
async function conversations(query, { limit = 6, exclude = null, person = null } = {}) {
  const recall = require('../harness/recall');
  const mem = require('../harness/memory');
  const keyword = recall.search(query, { limit: limit * 2, exclude, person });
  let semantic = [], note = null;
  const mine = require('../harness/session-access');
  const sessions = mem.listSessions().sessions.filter(s => s.id !== exclude && mine.mayUse(person, s.id));
  try {
    const items = sessions.map(s => ({ ref: s.id, text: [s.title, (s.topics || []).join(', '), s.summary].filter(Boolean).join('\n') }))
      .filter(i => i.text.trim());
    semantic = items.length ? await R.search('conversations', query, items, { limit: limit * 2 }) : [];
  } catch (e) { note = `(searched by keyword only: ${e.message})`; }
  const byId = new Map(keyword.map(h => [h.id, h]));
  const sById = new Map(sessions.map(s => [s.id, s]));
  const hits = R.hybrid(keyword.map(h => h.id), semantic.map(s => s.ref)).slice(0, limit).map(id => byId.get(id) || (sById.has(id) && (s => ({
    id: s.id, title: s.title, kind: s.kind, updatedAt: s.updatedAt, archived: !!s.archivedAt, topics: s.topics || [],
    summary: s.summary ? String(s.summary).slice(0, 600) : '', matches: [] }))(sById.get(id)))).filter(Boolean);
  return { hits, note };
}

module.exports = { memory, conversations };
