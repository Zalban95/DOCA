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
 *
 * An entry is not a scratch variable. Three things protect what has proven out:
 *
 *   locked    the user marked this fact as settled. The agent may read it and
 *             may dispute it, but cannot overwrite or delete it — only the
 *             console can, the same shape as a settings proposal.
 *   disputed  something contradicted this fact. It stays, with what contradicted
 *             it and when, because "the docs say 9876 but nothing listens there"
 *             is worth more than the silence left by deleting the entry.
 *   history   the last few values of a key, so an overwrite is recoverable and
 *             a fact that keeps flip-flopping is visible as one.
 *
 * The rules are protected differently: `rulesPatch()` changes one rule without
 * retyping the other twenty-nine, so an agent adding a rule cannot quietly drop
 * the ones it did not think to repeat.
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
    'When something you remembered turns out wrong, flag it with memory_flag in the same turn, saying what '
      + 'contradicted it. Forget it only once you know the right answer — a fact known to be wrong is still information.',
    'A locked entry is the user\'s settled answer. Do not work around it: dispute it with evidence and let them decide.',
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

function createSession(title, { activate = true, kind = 'work', parentId = null, profile = null } = {}) {
  const now = new Date().toISOString();
  const s = {
    id: newId('s'), title: title || 'New conversation',
    createdAt: now, updatedAt: now,
    count: 0, summary: '', summarizedThrough: 0,
    kind, parentId, profile, archivedAt: null,
  };
  const doc = readIndex();
  doc.sessions.push(s);
  if (activate) doc.active = s.id;
  writeIndex(doc);
  return s;
}

/** The user-facing conversation is independent of the Harness selection. */
function mainSession() {
  const doc = readIndex();
  const found = doc.sessions.find(s => s.id === doc.main && !s.archivedAt);
  if (found) return found;
  const session = createSession('Orchestrator', { activate: false, kind: 'orchestrator' });
  const next = readIndex();
  next.main = session.id;
  writeIndex(next);
  return session;
}

function resetMain() {
  const previous = mainSession();
  if (require('./agent').isRunning(previous.id)) throw Object.assign(new Error('Stop the Orchestrator before clearing chat.'), { status: 409 });
  updateSession(previous.id, { archivedAt: new Date().toISOString() });
  const next = mainSession();
  for (const child of listSessions().sessions) {
    if (child.parentId === previous.id) updateSession(child.id, { parentId: next.id });
  }
  updateSession(next.id, { reports: previous.reports || [] });
  if (listSessions().active === previous.id) setActive(next.id);
  return next;
}

/**
 * The session to talk to right now: the last one used, or a fresh one. Callers
 * never have to deal with "no session yet".
 */
function activeSession() {
  const doc = readIndex();
  const found = doc.active && doc.sessions.find(s => s.id === doc.active && !s.archivedAt);
  if (found) return found;
  const newest = doc.sessions.filter(s => !s.archivedAt).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
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

/**
 * Patch several sessions in one read and one write.
 *
 * `updateSession` reads and rewrites the entire index per call, so a caller that
 * has several sessions to touch pays for the whole file once each. That is not
 * hypothetical: a report fans out to every ancestor of the conversation that
 * sent it, so one report cost two or three full rewrites of `sessions.json`.
 *
 * `make` is handed the current row — never undefined, because an id that is not
 * in the index is skipped rather than created — and returns the patch. Rows are
 * touched in the order given and all take the same `updatedAt`, which is what a
 * fan-out means: one moment, several conversations.
 *
 * @returns {object[]} the rows that were changed, in the order given
 */
function updateSessions(ids, make) {
  const doc = readIndex();
  const at = new Date().toISOString();
  const touched = [];
  for (const id of ids) {
    const s = doc.sessions.find(x => x.id === id);
    if (!s) continue;
    Object.assign(s, make(s) || {}, { updatedAt: at });
    touched.push(s);
  }
  if (touched.length) writeIndex(doc);
  return touched;
}

function deleteSession(id) {
  if (require('./agent').isRunning(id)) throw Object.assign(new Error('Stop this conversation before deleting it.'), { status: 409 });
  const doc = readIndex();
  if (id === doc.main) throw Object.assign(new Error('The Orchestrator is persistent. Clear chat to archive it and start a new one.'), { status: 409 });
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
  if (s && !s.titleLocked && s.kind !== 'orchestrator' && s.count === 0 && msg.role === 'user' && typeof msg.content === 'string')
    patch.title = msg.content.trim().replace(/\s+/g, ' ').slice(0, 60) || s.title;
  updateSession(id, patch);
  return row;
}

/**
 * Where a transcript may be cut: anywhere except inside a tool-call group.
 *
 * A `tool` row only means anything after the assistant message carrying the
 * `tool_calls` it answers, and providers enforce it — DeepSeek answers a window
 * that opens on one with `Messages with role 'tool' must be a response to a
 * preceding message with 'tool_calls'` and HTTP 400. Both cuts here used to be
 * chosen by counting rows, and roughly half the rows in a working session are a
 * call or its result, so cutting through a pair was a coin flip.
 *
 * Forward first, so the whole group ends up on the same side of the cut;
 * backwards only when going forward would leave nothing live at all.
 */
function foldBoundary(rows, at, floor) {
  const start = Math.min(Math.max(at, floor), rows.length);
  let i = start;
  while (i < rows.length && rows[i].role === 'tool') i++;
  if (i < rows.length) return i;
  i = start;
  while (i > floor && rows[i].role === 'tool') i--;
  return i;
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
  // Never cut inside the turn in progress. A turn with ten tool calls is more
  // than 24 rows, and cutting it dropped the user's own request and the agent's
  // early work mid-turn — rows no summary covers yet, so they were simply gone.
  // ponytail: a single turn larger than the model's window is still refused by
  // the provider; splitting a turn is its own feature.
  const turnStart = live.map(r => r.role).lastIndexOf('user');
  const cut = historyTurns > 0 ? Math.max(0, live.length - historyTurns) : 0;
  let kept = live.slice(turnStart >= 0 ? Math.min(cut, turnStart) : cut);
  // The cap is the second cut with the same hazard, and it also repairs a
  // session whose stored boundary was set before there was a rule: the rows
  // dropped here are the oldest, which is what the cap was discarding anyway.
  let orphans = 0;
  while (orphans < kept.length && kept[orphans].role === 'tool') orphans++;
  if (orphans) kept = kept.slice(orphans);
  return { summary: s?.summary || '', rows: kept, folded: rows.length - kept.length };
}

/**
 * Rows waiting to be folded into the summary, or null when there is no need.
 *
 * `force` is the token-pressure path: the message count says there is room but
 * the window says otherwise, which is the normal case once tool output is in the
 * transcript. Four rows is the floor — folding two messages costs a model call
 * and saves nothing.
 */
function pendingFold(id, summarizeAfter, { force = false } = {}) {
  const s    = getSession(id);
  const rows = messages(id);
  const from = Math.max(0, s?.summarizedThrough || 0);
  const live = rows.slice(from);
  if (force) {
    // Token pressure strikes mid-turn, and folding "the older half" then meant
    // summarising the turn in progress — the code the agent is iterating on,
    // clipped into 250 words — and doing it again on the next step, because
    // the fold barely shrank the prompt. Under pressure, fold only earlier turns;
    // when there are none, there is nothing to fold and no model call is made.
    const turnStart = rows.map(r => r.role).lastIndexOf('user');
    const upTo = foldBoundary(rows, turnStart, from);
    if (turnStart <= from || upTo - from < 4 || upTo > turnStart) return null;
    return { rows: rows.slice(from, upTo), through: upTo, previous: s?.summary || '' };
  }
  if (!summarizeAfter || live.length <= summarizeAfter) return null;
  // Fold the older half, so the model still sees plenty of recent context —
  // snapped to a row that is not the answer to a call being folded away, since
  // `through` is persisted and one bad boundary breaks every later turn.
  const upTo = foldBoundary(rows, from + Math.floor(live.length / 2), from);
  if (upTo <= from) return null;
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
function memWrite({ key, value, tags, pinned, source, category, locked }) {
  if (!key || !String(key).trim())     throw Object.assign(new Error('key required'),   { status: 400 });
  if (value === undefined || value === null || !String(value).trim())
    throw Object.assign(new Error('value required'), { status: 400 });

  const doc  = readMemory();
  const k    = String(key).trim().slice(0, 120);
  const now  = new Date().toISOString();
  const list = Array.isArray(tags) ? tags.map(String) : String(tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const existing = doc.entries.find(e => e.key.toLowerCase() === k.toLowerCase());
  const byUser   = (source || 'user') === 'user';

  // The one thing the agent may not do to its own memory. A fact the user
  // locked has been checked by them; an agent that could overwrite it would
  // make the lock decoration, the same argument as the safety charter.
  if (existing && existing.locked && !byUser)
    throw Object.assign(new Error(
      `"${existing.key}" is locked: the user marked it as settled, so it cannot be overwritten here. `
      + 'If something contradicts it, record that with memory_flag and say so in your answer — '
      + 'they decide whether the fact changes.'), { status: 409 });

  const entry = existing || { id: newId('m'), key: k, createdAt: now, hits: 0 };
  const previous = entry.value;

  entry.value     = String(value).trim().slice(0, 4000);
  entry.tags      = list.slice(0, 8);
  entry.pinned    = pinned === undefined ? !!entry.pinned : !!pinned;
  entry.source    = source || entry.source || 'user';
  entry.updatedAt = now;

  // Locking is the user's word, so it travels only on their writes. An agent
  // that passes it is not refused — it is simply not the author of that field.
  if (byUser && locked !== undefined) entry.locked = !!locked;

  if (previous !== undefined && previous !== entry.value) {
    // Bounded: this is a safety net for the last overwrite or two, not a log.
    entry.history = [{ value: previous, at: existing.updatedAt || entry.createdAt, source: existing.source || null },
      ...(entry.history || [])].slice(0, 3);
    // A new value is an answer to whatever contradicted the old one.
    delete entry.disputed;
  }
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

/**
 * Change one rule without retyping the rest.
 *
 * `rulesWrite` replaces a whole list, which is right for the modal — the user is
 * looking at all of them — and wrong for the agent, which reaches for it to add
 * a single line and has to reproduce twenty-nine others from memory to do it.
 * Every one it forgets is silently deleted. This is the selective form: the
 * lists it does not mention are not touched, and neither are the entries it
 * does not name.
 *
 * @param {{ add?: string[], remove?: (number|string)[], replace?: {index:number, text:string}[],
 *           addCategories?: object[], removeCategories?: string[], source?: string }} input
 */
function rulesPatch({ add, remove, replace, addCategories, removeCategories, source } = {}) {
  const current = rules();
  let list = [...current.rules];
  let cats = [...current.categories];

  // Replace first, while the indexes still mean what the caller saw.
  for (const r of (Array.isArray(replace) ? replace : [])) {
    const i = Number(r?.index);
    if (!Number.isInteger(i) || i < 1 || i > list.length)
      throw Object.assign(new Error(`there is no rule ${r?.index} to replace (1-${list.length})`), { status: 400 });
    const text = String(r?.text ?? '').trim().replace(/^[-*]\s*/, '').slice(0, 300);
    if (!text) throw Object.assign(new Error(`rule ${i}: replacement text is empty`), { status: 400 });
    list[i - 1] = text;
  }

  // Then remove, by number or by the text itself, highest index first so the
  // earlier ones keep their positions.
  const drop = new Set();
  for (const r of (Array.isArray(remove) ? remove : [])) {
    if (typeof r === 'number' || /^\d+$/.test(String(r))) {
      const i = Number(r);
      if (!Number.isInteger(i) || i < 1 || i > list.length)
        throw Object.assign(new Error(`there is no rule ${r} to remove (1-${list.length})`), { status: 400 });
      drop.add(i - 1);
    } else {
      const i = list.findIndex(x => x === String(r).trim());
      if (i < 0) throw Object.assign(new Error(`no rule reads exactly "${String(r).slice(0, 60)}"`), { status: 400 });
      drop.add(i);
    }
  }
  list = list.filter((_, i) => !drop.has(i));

  for (const r of (Array.isArray(add) ? add : [])) {
    const text = String(r ?? '').trim().replace(/^[-*]\s*/, '').slice(0, 300);
    if (text && !list.includes(text)) list.push(text);
  }

  for (const c of (Array.isArray(addCategories) ? addCategories : [])) {
    const id = String((typeof c === 'string' ? c : c?.id) || '').trim().slice(0, 40);
    if (!id || cats.some(x => x.id === id)) continue;
    cats.push({ id, description: String((typeof c === 'string' ? '' : c?.description) || '').trim().slice(0, 200) });
  }
  if (Array.isArray(removeCategories) && removeCategories.length) {
    const gone = new Set(removeCategories.map(x => String(x).trim()));
    cats = cats.filter(c => !gone.has(c.id));
  }

  return rulesWrite({ categories: cats, rules: list, source: source || 'agent' });
}

/** Back to the shipped rules, for when an experiment made them worse. */
function rulesReset() {
  store.removeJson(RULES_DOC);
  return rules();
}

/** The entry a key or id names, or null. */
function memFind(idOrKey) {
  const needle = String(idOrKey || '').toLowerCase();
  return readMemory().entries.find(e => e.id === idOrKey || e.key.toLowerCase() === needle) || null;
}

function memForget(idOrKey, { source } = {}) {
  const doc   = readMemory();
  const found = doc.entries.find(e =>
    e.id === idOrKey || e.key.toLowerCase() === String(idOrKey).toLowerCase());
  if (!found) throw Object.assign(new Error('No such entry'), { status: 404 });

  if (found.locked && (source || 'user') !== 'user')
    throw Object.assign(new Error(
      `"${found.key}" is locked and cannot be forgotten here. Flag it with memory_flag instead, `
      + 'saying what contradicted it.'), { status: 409 });

  doc.entries = doc.entries.filter(e => e !== found);
  store.writeJson(MEMORY_DOC, doc);
}

/**
 * Something contradicted a remembered fact. Keep the fact, attach what
 * happened.
 *
 * Deleting here would be the expensive mistake: the next conversation would
 * rediscover the same wrong thing with no record that it had already been
 * tried. A disputed entry still reaches the prompt, marked, so the agent knows
 * to verify it rather than lean on it.
 */
function memDispute(idOrKey, { note, source } = {}) {
  const doc   = readMemory();
  const found = doc.entries.find(e =>
    e.id === idOrKey || e.key.toLowerCase() === String(idOrKey).toLowerCase());
  if (!found) throw Object.assign(new Error('No such entry'), { status: 404 });
  if (!note || !String(note).trim())
    throw Object.assign(new Error('say what contradicted it'), { status: 400 });

  found.disputed = {
    at:   new Date().toISOString(),
    by:   source || 'agent',
    note: String(note).trim().slice(0, 600),
  };
  store.writeJson(MEMORY_DOC, doc);
  return found;
}

/** Settle or unsettle a fact. The console's call, never the agent's. */
function memLock(idOrKey, locked) {
  const doc   = readMemory();
  const found = doc.entries.find(e =>
    e.id === idOrKey || e.key.toLowerCase() === String(idOrKey).toLowerCase());
  if (!found) throw Object.assign(new Error('No such entry'), { status: 404 });
  found.locked = !!locked;
  found.updatedAt = new Date().toISOString();
  store.writeJson(MEMORY_DOC, doc);
  return found;
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
  if (!terms.length) return memList().filter(e => e.pinned).slice(0, limit);

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
  listSessions, createSession, mainSession, resetMain, activeSession, getSession, setActive, updateSession,
  updateSessions, deleteSession,
  messages, append, window, pendingFold,
  memWrite, memForget, memList, memSearch, memTouch, memDispute, memLock, memFind,
  DEFAULT_RULES, rules, rulesWrite, rulesPatch, rulesReset,
};
