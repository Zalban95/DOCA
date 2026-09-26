'use strict';

/**
 * Recall: find an earlier conversation about the thing at hand.
 *
 * TODO.md "Nothing searches across conversations". Every session already
 * carries a title, a rolling summary (turn/summary.js) and, since the fold
 * names them, a few `topics`; this searches those, and — for what the summary
 * did not keep — the transcripts' own words. Called by the agent through the
 * `recall_conversations` tool when the subject is relevant; never injected
 * into a prompt, which would spend the window it is meant to protect.
 *
 * Word overlap, like memSearch: no model call, no index to keep warm. The TODO
 * entry after this one says when that stops being enough.
 */
const fs     = require('fs');
const path   = require('path');
const store  = require('../store');
const memory = require('./memory');

const SCAN_SESSIONS = 300;          // newest transcripts read for words the summary did not keep
const SCAN_BYTES    = 4 << 20;      // a transcript larger than this is searched by its summary only
const terms = q => [...new Set(String(q || '').toLowerCase().split(/[^\p{L}\p{N}_.-]+/u).filter(t => t.length > 1))];
const transcript = id => path.join(store.dir('harness/sessions'), `${id}.jsonl`);

/** A short piece of `text` around the first term it holds. */
function excerpt(text, ts, width = 160) {
  const low = text.toLowerCase();
  const at = Math.min(...ts.map(t => low.indexOf(t)).filter(i => i >= 0));
  if (!Number.isFinite(at)) return '';
  const from = Math.max(0, at - width / 2);
  return `${from ? '…' : ''}${text.slice(from, from + width).replace(/\s+/g, ' ').trim()}${from + width < text.length ? '…' : ''}`;
}

/** Transcript rows (the person's and the agent's words, not tool output) holding the terms. */
function transcriptHits(id, ts, max = 3) {
  const file = transcript(id);
  try { if (fs.statSync(file).size > SCAN_BYTES) return []; } catch { return []; }
  const out = [];
  for (const r of store.readJsonl(file)) {
    if ((r.role !== 'user' && r.role !== 'assistant') || typeof r.content !== 'string') continue;
    const low = r.content.toLowerCase();
    const n = ts.filter(t => low.includes(t)).length;
    if (n) out.push({ n, role: r.role, at: r.at, text: excerpt(r.content, ts) });
  }
  return out.sort((a, b) => b.n - a.n).slice(0, max);
}

/**
 * Conversations about `query`, best first: [{ id, title, kind, updatedAt,
 * topics, summary, matches }]. `exclude` is the asking conversation.
 */
function search(query, { limit = 6, exclude = null } = {}) {
  const ts = terms(query);
  if (!ts.length) return [];
  const rows = memory.listSessions().sessions.filter(s => s.id !== exclude);
  const scored = rows.map((s, i) => {
    const title = String(s.title || '').toLowerCase(), topics = (s.topics || []).join(' ').toLowerCase();
    const summary = String(s.summary || '');
    let score = 0;
    for (const t of ts) {
      if (title.includes(t)) score += 3;
      if (topics.includes(t)) score += 3;
      if (summary.toLowerCase().includes(t)) score += 1;
    }
    const matches = i < SCAN_SESSIONS ? transcriptHits(s.id, ts) : [];
    score += Math.min(3, matches.reduce((n, m) => n + m.n, 0) / ts.length);
    return { s, score, matches };
  }).filter(x => x.score > 0);

  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ s, matches }) => ({
    id: s.id, title: s.title, kind: s.kind, updatedAt: s.updatedAt, archived: !!s.archivedAt,
    topics: s.topics || [], summary: s.summary ? String(s.summary).slice(0, 600) : '', matches,
  }));
}

/** One earlier conversation: its summary and its last words, bounded. */
function read(id, { last = 12 } = {}) {
  const s = memory.getSession(id);
  if (!s) throw Object.assign(new Error(`No conversation ${id}. Search first; the ids come from there.`), { status: 404 });
  const tail = memory.messages(id).filter(r => (r.role === 'user' || r.role === 'assistant') && typeof r.content === 'string' && r.content.trim())
    .slice(-last).map(r => ({ role: r.role, at: r.at, text: r.content.slice(0, 1200) }));
  return { id, title: s.title, kind: s.kind, updatedAt: s.updatedAt, topics: s.topics || [], summary: s.summary || '', messages: tail };
}

/**
 * The fold's closing "Topics: a, b, c" line, split off the summary it ends.
 * Returns { summary, topics } — topics null when the model left the line out.
 */
function splitTopics(text) {
  const m = /\n?\s*topics:\s*(.+)\s*$/i.exec(String(text || ''));
  if (!m) return { summary: String(text || '').trim(), topics: null };
  const topics = [...new Set(m[1].split(',').map(t => t.trim().toLowerCase().replace(/[.`*]+$/g, '')).filter(t => t && t.length <= 40))].slice(0, 8);
  return { summary: String(text).slice(0, m.index).trim(), topics };
}

module.exports = { search, read, splitTopics, terms };
