'use strict';

/**
 * Structured memory for the built-in harness. Three layers, all durable under
 * DOCA_DATA_DIR/harness so a restart (or a `⟳ Restart`) loses nothing:
 *
 *   sessions/<id>.jsonl  the verbatim transcript of one conversation
 *   sessions.json        the index: title, counts, rolling summary, which
 *                        transcript rows the summary already covers
 *   memory.json          durable entries the agent writes for itself — facts
 *                        about the machine, paths, preferences, standing
 *                        instructions — searched by keyword and injected into
 *                        the system prompt every turn
 *
 * The split is what lets a conversation outlive its context window: rows older
 * than the live window fold into `summary`, while anything worth keeping
 * forever has already been promoted into memory.json by the agent.
 */
const path = require('path');

const store = require('../store');

const SESSIONS_DOC = 'harness/sessions';
const MEMORY_DOC   = 'harness/memory';
const RULES_DOC    = 'harness/memory-rules';

/**
 * How memory is meant to be kept — categories and house rules, in the prompt
 * every turn.
 *
 * These are the shipped defaults, not the law: the agent can rewrite them with
 * `memory_rules_write` and the user can edit them in the console, because the
 * one keeping this memory is the one best placed to say what belongs in it.
 * What the agent cannot edit is the safety charter in `providers.js` — a rule
 * about not storing secrets that the agent could delete would be worth nothing.
 */
const DEFAULT_RULES = {
  categories: [
    { id: 'machine', description: 'Hardware, OS, GPUs, disks, ports — what is true of this host' },
    { id: 'paths',   description: 'Where things live on this box, and which of them are managed by the panel' },
    { id: 'stack',   description: 'How the services, containers and models are set up and run' },
    { id: 'prefs',   description: 'The user\'s standing preferences and instructions, in their words' },
    { id: 'project', description: 'Facts about the code and projects in the workspace' },
    { id: 'open',    description: 'Unfinished threads worth picking up in a later conversation' },
  ],
  rules: [
    'One fact per entry. Key it the way you would search for it later, in lower case with dashes.',
    'Update the existing key instead of adding a near-duplicate; two versions of one fact are worse than none.',
    'Never store a secret, key, token or password. Record where it lives instead.',
    'Do not store what will be stale tomorrow (a container id, a free-RAM figure). Store how to find it out.',
    'Write down what the user tells you to do differently, and quote them.',
    'Say where a fact came from when you inferred it rather than observed it.',
    'Pin only what belongs in every conversation — about ten entries, not fifty.',
    'When something you remembered turns out wrong, forget it in the same turn you learn it was wrong.',
  ],
};

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function transcriptPath(id) {
  return path.join(store.dir('harness/sessions'), `${id}.jsonl`);
}

/* ── Sessions ─────────────────────────────────────────── */

function readIndex() {
  const doc = store.readJson(SESSIONS_DOC, { sessions: [], active: null });
  if (!Array.isArray(doc.sessions)) doc.sessions = [];
  return doc;
}

function writeIndex(doc) { store.writeJson(SESSIONS_DOC, doc); }

/** Newest first, without transcripts. */
function listSessions() {
  const doc = readIndex();
  return {
    sessions: [...doc.sessions].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    active: doc.active,
  };
}

function createSession(title) {
  const now = new Date().toISOString();
  const s = {
    id: newId('s'), title: title || 'New conversation',
    createdAt: now, updatedAt: now,
    count: 0, summary: '', summarizedThrough: 0,
  };
  const doc = readIndex();
  doc.sessions.push(s);
  doc.active = s.id;
  writeIndex(doc);
  return s;
}

/**
 * The session to talk to right now: the last one used, or a fresh one. Callers
 * never have to deal with "no session yet".
 */
function activeSession() {
  const doc = readIndex();
  const found = doc.active && doc.sessions.find(s => s.id === doc.active);
  if (found) return found;
  const newest = [...doc.sessions].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
  if (newest) { doc.active = newest.id; writeIndex(doc); return newest; }
  return createSession();
}

function getSession(id) {
  return readIndex().sessions.find(s => s.id === id) || null;
}

function setActive(id) {
  const doc = readIndex();
  if (!doc.sessions.some(s => s.id === id)) throw Object.assign(new Error('Unknown session'), { status: 404 });
  doc.active = id;
  writeIndex(doc);
  return id;
}

function updateSession(id, patch) {
  const doc = readIndex();
  const s = doc.sessions.find(x => x.id === id);
  if (!s) throw Object.assign(new Error('Unknown session'), { status: 404 });
  Object.assign(s, patch, { updatedAt: new Date().toISOString() });
  writeIndex(doc);
  return s;
}

function deleteSession(id) {
  const doc = readIndex();
  doc.sessions = doc.sessions.filter(s => s.id !== id);
  if (doc.active === id) doc.active = doc.sessions[0]?.id || null;
  writeIndex(doc);
  try { require('fs').rmSync(transcriptPath(id), { force: true }); } catch {}
}

/** Every row of a transcript, oldest first. */
function messages(id) {
  return store.readJsonl(transcriptPath(id));
}

/**
 * Append one row and keep the index in step. The first user message also names
 * the session, so the picker is readable without anyone typing a title.
 */
function append(id, msg) {
  const row = { ...msg, at: msg.at || new Date().toISOString() };
  store.appendJsonl(transcriptPath(id), row);
  const s = getSession(id);
  const patch = { count: (s?.count || 0) + 1 };
  if (s && s.count === 0 && msg.role === 'user' && typeof msg.content === 'string')
    patch.title = msg.content.trim().replace(/\s+/g, ' ').slice(0, 60) || s.title;
  updateSession(id, patch);
  return row;
}

/**
 * The live window: the rolling summary plus every row the summary does not
 * already cover, capped at `historyTurns` rows.
 * @returns {{ summary: string, rows: object[], folded: number }}
 */
function window(id, historyTurns) {
  const s    = getSession(id);
  const rows = messages(id);
  const from = Math.max(0, s?.summarizedThrough || 0);
  const live = rows.slice(from);
  const kept = historyTurns > 0 ? live.slice(-historyTurns) : live;
  return { summary: s?.summary || '', rows: kept, folded: rows.length - kept.length };
}

/** Rows waiting to be folded into the summary, or null when there is no need. */
function pendingFold(id, summarizeAfter) {
  const s    = getSession(id);
  const rows = messages(id);
  const from = Math.max(0, s?.summarizedThrough || 0);
  const live = rows.slice(from);
  if (!summarizeAfter || live.length <= summarizeAfter) return null;
  // Fold the older half, so the model still sees plenty of recent context.
  const upTo = from + Math.floor(live.length / 2);
  return { rows: rows.slice(from, upTo), through: upTo, previous: s?.summary || '' };
}

/* ── Durable memory entries ───────────────────────────── */

function readMemory() {
  const doc = store.readJson(MEMORY_DOC, { entries: [] });
  if (!Array.isArray(doc.entries)) doc.entries = [];
  return doc;
}

/**
 * Write or overwrite one entry. Keys are unique and case-insensitive: writing
 * the same key twice updates it rather than leaving the agent to read two
 * contradictory versions of the same fact later.
 */
function memWrite({ key, value, tags, pinned, source, category }) {
  if (!key || !String(key).trim())     throw Object.assign(new Error('key required'),   { status: 400 });
  if (value === undefined || value === null || !String(value).trim())
    throw Object.assign(new Error('value required'), { status: 400 });

  const doc  = readMemory();
  const k    = String(key).trim().slice(0, 120);
  const now  = new Date().toISOString();
  const list = Array.isArray(tags) ? tags.map(String) : String(tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const existing = doc.entries.find(e => e.key.toLowerCase() === k.toLowerCase());

  const entry = existing || { id: newId('m'), key: k, createdAt: now, hits: 0 };
  entry.value     = String(value).trim().slice(0, 4000);
  entry.tags      = list.slice(0, 8);
  entry.pinned    = pinned === undefined ? !!entry.pinned : !!pinned;
  entry.source    = source || entry.source || 'user';
  entry.updatedAt = now;
  // A category outside the current list is still stored. The taxonomy is the
  // agent's own and it may be mid-rethink; losing the fact to enforce it would
  // be the wrong trade.
  if (category !== undefined) entry.category = String(category || '').trim().slice(0, 40) || undefined;

  if (!existing) doc.entries.push(entry);
  store.writeJson(MEMORY_DOC, doc);
  return entry;
}

/* ── The rules memory is kept by ──────────────────────── */

/** The rules in force: what was saved, or the shipped defaults. */
function rules() {
  const doc = store.readJson(RULES_DOC, null);
  if (!doc || !Array.isArray(doc.rules) || !Array.isArray(doc.categories))
    return { ...DEFAULT_RULES, source: 'default', updatedAt: null };
  return doc;
}

/**
 * Replace the categories, the rules, or both. Whatever is left out is kept, so
 * "add a rule" is a read plus a write of the one list that changed.
 *
 * Bounded on purpose: this text is in the system prompt of every turn, and an
 * agent that keeps appending to its own instructions would quietly eat the
 * context window it was trying to spend well.
 */
function rulesWrite({ categories, rules: list, source } = {}) {
  const current = rules();

  const nextCats = categories === undefined ? current.categories
    : (Array.isArray(categories) ? categories : [])
      .map(c => (typeof c === 'string'
        ? { id: c.trim().slice(0, 40), description: '' }
        : { id: String(c?.id || '').trim().slice(0, 40), description: String(c?.description || '').trim().slice(0, 200) }))
      .filter(c => c.id)
      .slice(0, 20);

  const nextRules = list === undefined ? current.rules
    : (Array.isArray(list) ? list : String(list).split('\n'))
      .map(r => String(r).trim().replace(/^[-*]\s*/, '').slice(0, 300))
      .filter(Boolean)
      .slice(0, 30);

  if (!nextCats.length)  throw Object.assign(new Error('at least one category is required'), { status: 400 });
  if (!nextRules.length) throw Object.assign(new Error('at least one rule is required'), { status: 400 });

  const doc = {
    categories: nextCats,
    rules: nextRules,
    source: source || 'user',
    updatedAt: new Date().toISOString(),
  };
  store.writeJson(RULES_DOC, doc);
  return doc;
}

/** Back to the shipped rules, for when an experiment made them worse. */
function rulesReset() {
  store.removeJson(RULES_DOC);
  return rules();
}

function memForget(idOrKey) {
  const doc  = readMemory();
  const kept = doc.entries.filter(e =>
    e.id !== idOrKey && e.key.toLowerCase() !== String(idOrKey).toLowerCase());
  if (kept.length === doc.entries.length) throw Object.assign(new Error('No such entry'), { status: 404 });
  doc.entries = kept;
  store.writeJson(MEMORY_DOC, doc);
}

/** Pinned first, then most recently updated. */
function memList() {
  return [...readMemory().entries].sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

/**
 * Keyword search over key, value and tags. Deliberately not embeddings: no
 * model call, no index to keep warm, and on a few hundred hand-written facts
 * word overlap finds the right one.
 */
function memSearch(query, limit = 8) {
  const terms = String(query || '').toLowerCase().split(/[^a-z0-9_.-]+/).filter(t => t.length > 1);
  if (!terms.length) return memList().slice(0, limit);

  return memList()
    .map(e => {
      const key  = e.key.toLowerCase();
      const hay  = `${key} ${e.value} ${(e.tags || []).join(' ')}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (key.includes(t)) score += 3;
        if (hay.includes(t)) score += 1;
      }
      if (e.pinned) score += 1;
      return { e, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.e);
}

/** Bump usage counters so the prompt block favours entries that get used. */
function memTouch(entries) {
  if (!entries.length) return;
  const doc = readMemory();
  for (const hit of entries) {
    const e = doc.entries.find(x => x.id === hit.id);
    if (e) e.hits = (e.hits || 0) + 1;
  }
  store.writeJson(MEMORY_DOC, doc);
}

module.exports = {
  listSessions, createSession, activeSession, getSession, setActive, updateSession, deleteSession,
  messages, append, window, pendingFold,
  memWrite, memForget, memList, memSearch, memTouch,
  DEFAULT_RULES, rules, rulesWrite, rulesReset,
};
