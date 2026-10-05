'use strict';

/**
 * Projects: a folder on this machine, and the work chat that works in it.
 *
 * A project is a record, not a process — its root, a name, the work chat bound
 * to it, and any commands the owner added or changed. Everything else (its
 * kind, its commands, its git state, which toolchains are here) is read from
 * the folder each time (./inspect.js, ./git.js), so it can never be stale.
 *
 * Binding a work chat to a project makes the project its place: its shell and
 * file tools start at the project root (toolbox/common.cwd), its specialists
 * inherit that, and its prompt carries the project brief (./brief.js).
 *
 * Stored in `<DATA_DIR>/projects/projects.json`.
 */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const store = require('../store');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function rows() { return store.readJson('projects/projects', { projects: [] }).projects; }
function save(list) { store.writeJson('projects/projects', { projects: list }); }

function list() { return rows().slice().sort((a, b) => String(b.openedAt || b.createdAt).localeCompare(String(a.openedAt || a.createdAt))); }
function get(id) { return rows().find(p => p.id === id) || null; }

function need(id) {
  const p = get(id);
  if (!p) throw bad(`No project "${id}".`, 404);
  return p;
}

/** A project for a folder; the same folder twice is the same project. */
function create({ root, name } = {}) {
  const { fmSafe } = require('../utils');
  const abs = path.resolve(String(root || '').replace(/^~(?=$|[/\\])/, require('os').homedir()));
  if (!root || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw bad(`${abs} is not a folder.`);
  if (!fmSafe(abs)) throw bad(`${abs} is outside the folders the panel may open.`, 403);
  const same = rows().find(p => p.root === abs);
  if (same) return same;
  const p = { id: `prj_${crypto.randomBytes(5).toString('hex')}`, name: String(name || path.basename(abs)).slice(0, 80),
    root: abs, sessionId: null, commands: {}, createdAt: new Date().toISOString() };
  save([...rows(), p]);
  return p;
}

function update(id, patch) {
  need(id);
  const allowed = {};
  if (patch.name !== undefined) allowed.name = String(patch.name).slice(0, 80);
  if (patch.commands !== undefined) {
    // The owner's own commands, by name: { deploy: "./deploy.sh" }; an empty string removes one.
    const c = {};
    for (const [k, v] of Object.entries(patch.commands || {})) if (/^[\w:-]{1,40}$/.test(k)) c[k] = String(v).slice(0, 500);
    allowed.commands = c;
  }
  if (patch.env !== undefined) {
    // Which Python the project uses (env.js): 'machine', a venv folder in the root, or null for "a venv if there is one".
    const py = patch.env?.python;
    if (py != null && py !== 'machine' && !/^[\w.-]{1,40}$/.test(String(py))) throw bad('env.python is "machine" or a folder name in the project.');
    allowed.env = { python: py ?? null };
  }
  for (const k of ['sessionId', 'openedAt']) if (patch[k] !== undefined) allowed[k] = patch[k];
  save(rows().map(p => (p.id === id ? { ...p, ...allowed } : p)));
  return get(id);
}

function remove(id) {
  need(id);
  save(rows().filter(p => p.id !== id));
  // Its checkpoints are this panel's undo history of a project that is no longer here, and a project
  // added again gets a new id — so they would be orphaned for good (live test 2026-10-04). The folder
  // itself is the person's and is never touched.
  const dir = store.dir('checkpoints');
  for (const f of [`${id}.git`, `${id}.json`]) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
}

/**
 * The project a conversation works in: its own binding, or the nearest
 * ancestor's (a specialist a bound work chat dispatched works there too).
 */
function forSession(sessionId) {
  if (!sessionId) return null;
  const memory = require('../harness/memory');
  const seen = new Set();
  let id = sessionId;
  let wt = null;   // the nearest conversation up the chain working in its own worktree (projects/worktrees.js)
  while (id && !seen.has(id)) {
    seen.add(id);
    const s = memory.getSession(id);
    if (!s) break;
    if (!wt && s.worktree?.path && require('fs').existsSync(s.worktree.path)) wt = s.worktree;
    if (s.projectId) { const p = get(s.projectId); return p && wt ? { ...p, root: wt.path, mainRoot: p.root, worktree: wt } : p; }
    const mission = require('../agents/missions').forSession(id);
    id = s.parentId || mission?.by || null;
  }
  return null;
}

/**
 * The project's work chat: the one bound to it, or a new one under the
 * Orchestrator. Binding is recorded on both sides.
 */
function workChat(id) {
  const p = need(id);
  const memory = require('../harness/memory');
  if (p.sessionId && memory.getSession(p.sessionId)) return memory.getSession(p.sessionId);
  const org = require('../harness/organization');
  const s = org.create({ title: `Project: ${p.name}` });
  bind(p.id, s.id);
  return memory.getSession(s.id);
}

/**
 * Every conversation working in this project (asked 2026-10-04: chat tabs, with sub-agents in parallel tabs):
 * the ones bound to it, then what they started — work chats and specialists below them — oldest first.
 */
function chats(id, { all = false } = {}) {
  need(id);
  const memory = require('../harness/memory'), org = require('../harness/organization');
  return memory.listSessions().sessions
    .filter(s => (all || !s.archivedAt) && s.kind !== 'orchestrator' && forSession(s.id)?.id === id)
    .map(s => ({ ...org.view(s), sub: !memory.getSession(s.id)?.projectId, running: require('../harness/agent').isRunning(s.id), worktree: memory.getSession(s.id)?.worktree?.branch || null,
      page: memory.getSession(s.id)?.page || null }))
    .sort((a, b) => Number(a.sub) - Number(b.sub) || String(a.updatedAt).localeCompare(String(b.updatedAt)));
}

/** A new chat in this project: a work chat bound to it, as the first one is. */
function newChat(id, { title, page } = {}) {
  const p = need(id);
  const about = page ? require('./pages').check(p, page) : null;   // a chat about one page (pages.js)
  const s = require('../harness/organization').create({ title: String(title || '').trim() || (about ? `📄 ${path.basename(about.rel, '.md')}` : `${p.name} chat`) });
  bind(p.id, s.id);
  if (about) require('../harness/memory').updateSession(s.id, { page: about.rel });
  return require('../harness/memory').getSession(s.id);
}

function bind(id, sessionId) {
  need(id);
  const memory = require('../harness/memory');
  if (!memory.getSession(sessionId)) throw bad('No such conversation.', 404);
  memory.updateSession(sessionId, { projectId: id });
  return update(id, { sessionId });
}

module.exports = { list, get, need, create, update, remove, forSession, workChat, bind, chats, newChat };
