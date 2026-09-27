'use strict';

/**
 * Every read and write of authentication state, and nothing else.
 *
 * Decided 2026-09-25 (docs/design/auth.md §8): JSON documents now, a database
 * later, on the condition that the move costs one file. So the functions below
 * are the *queries* — by email, by token hash, of a user — and no caller ever
 * sees a document. A database implementation is this list of functions over
 * tables; test/auth-store.test.js is the contract both must pass.
 *
 * Documents, under DATA_DIR/auth/ (store.js: atomic, 0600):
 *   users        { [id]: { id, email, name, passwordHash, mustChangePassword, createdAt, suspendedAt? } }
 *   orgs         { [id]: { id, name, createdAt } }
 *   memberships  [ { orgId, userId, role, status, approvedBy?, approvedAt?, createdAt } ]
 *   sessions     { [tokenHash]: { userId, orgId, createdAt, expiresAt, lastSeenAt, stepUpAt, userAgent, ip } }
 *   audit-YYYY-MM.jsonl  append-only, a file a month (audit.jsonl before 2.65)
 */
const crypto = require('crypto');
const path   = require('path');
const store  = require('../store');

const doc = name => `auth/${name}`;
const write = (name, data) => store.writeJson(doc(name), data);

/**
 * The gate reads users, memberships and sessions on every request. Parsed once
 * per change of the file (inode, size, mtime — a write is an atomic rename, so
 * the inode alone changes), and handed out as a copy, so a caller that edits
 * what it read and then fails to write cannot leave the edit in the cache.
 */
const _cache = new Map();   // name -> { key, data }
function read(name, fallback) {
  const file = path.join(store.DATA_DIR, `${doc(name)}.json`);
  let st;
  try { st = require('fs').statSync(file); } catch { _cache.delete(name); return store.readJson(doc(name), fallback); }
  const key = `${st.ino}:${st.size}:${st.mtimeMs}`;
  const hit = _cache.get(name);
  if (hit?.key === key) return structuredClone(hit.data);
  const data = store.readJson(doc(name), undefined);
  if (data === undefined) return typeof fallback === 'function' ? fallback() : fallback;
  _cache.set(name, { key, data });
  return structuredClone(data);
}
const id = prefix => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const now = () => new Date().toISOString();

/* ── Users ─────────────────────────────────────────────── */

function userCount() { return Object.keys(read('users', {})).length; }

function userById(userId) { return read('users', {})[userId] || null; }

/** Case-insensitive: nobody remembers how they capitalised their address. */
function userByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return Object.values(read('users', {})).find(u => u.email === e) || null;
}

function createUser({ email, name = '', passwordHash, mustChangePassword = false }) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) throw Object.assign(new Error('An email is required.'), { status: 400 });
  if (userByEmail(e)) throw Object.assign(new Error('That email already has an account.'), { status: 409 });
  const users = read('users', {});
  const u = { id: id('usr'), email: e, name: String(name).trim(), passwordHash, mustChangePassword, createdAt: now() };
  users[u.id] = u;
  write('users', users);
  return u;
}

function updateUser(userId, patch) {
  const users = read('users', {});
  if (!users[userId]) return null;
  users[userId] = { ...users[userId], ...patch, id: userId };
  write('users', users);
  return users[userId];
}

/* ── Organisations and memberships ─────────────────────── */

/** The organisation a personal install runs as; created with the first user. */
function defaultOrg() {
  return Object.values(read('orgs', {})).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] || null;
}

function createOrg(name) {
  const orgs = read('orgs', {});
  const o = { id: id('org'), name: String(name || 'DOCA'), createdAt: now() };
  orgs[o.id] = o;
  write('orgs', orgs);
  return o;
}

function membership(orgId, userId) {
  return read('memberships', []).find(m => m.orgId === orgId && m.userId === userId) || null;
}

function membershipsOf(userId) { return read('memberships', []).filter(m => m.userId === userId); }

function addMembership({ orgId, userId, role, status = 'active', approvedBy = null }) {
  const all = read('memberships', []).filter(m => !(m.orgId === orgId && m.userId === userId));
  const m = { orgId, userId, role, status, approvedBy, approvedAt: status === 'active' ? now() : null, createdAt: now() };
  all.push(m);
  write('memberships', all);
  return m;
}

/* ── Sessions ──────────────────────────────────────────── */

function createSession(tokenHash, rec) {
  const all = read('sessions', {});
  all[tokenHash] = { ...rec, createdAt: now(), lastSeenAt: now() };
  write('sessions', all);
  return all[tokenHash];
}

function sessionByHash(tokenHash) { return read('sessions', {})[tokenHash] || null; }

function updateSession(tokenHash, patch) {
  const all = read('sessions', {});
  if (!all[tokenHash]) return null;
  all[tokenHash] = { ...all[tokenHash], ...patch };
  write('sessions', all);
  return all[tokenHash];
}

function deleteSession(tokenHash) {
  const all = read('sessions', {});
  delete all[tokenHash];
  write('sessions', all);
}

/** Sign a user out everywhere, except (optionally) the session asking. */
function deleteSessionsOf(userId, except = null) {
  const all = read('sessions', {});
  for (const [h, s] of Object.entries(all)) if (s.userId === userId && h !== except) delete all[h];
  write('sessions', all);
}

function pruneSessions() {
  const all = read('sessions', {}), t = Date.now();
  let changed = false;
  for (const [h, s] of Object.entries(all)) if (Date.parse(s.expiresAt) < t) { delete all[h]; changed = true; }
  if (changed) write('sessions', all);
}

/* ── Audit ─────────────────────────────────────────────── */

/** Append only, and never deleted with what it describes. */
/*
 * The audit log is a table in the database since 2.108.0 (docs/design/database.md).
 * It was one file a month (audit-YYYY-MM.jsonl) before that, and a single
 * audit.jsonl before those; both are imported once, oldest first, and left on disk.
 */
const AUDIT_LEGACY = 'audit.jsonl';
const db = () => require('../db');

let _auditImported = null;
function auditImported() {
  if (!_auditImported) _auditImported = (async () => {
    if (await db().get("SELECT value FROM meta WHERE key = 'audit.imported'")) return;
    const dir = store.dir('auth');
    let months = [];
    try { months = require('fs').readdirSync(dir).filter(f => /^audit-\d{4}-\d{2}\.jsonl$/.test(f)).sort(); } catch { /* none */ }
    await db().tx(async q => {
      if (await q.get("SELECT value FROM meta WHERE key = 'audit.imported'")) return;   // another process got there first
      for (const f of [AUDIT_LEGACY, ...months]) for (const e of store.readJsonl(path.join(dir, f))) await insertAudit(q, e);
      await q.run("INSERT INTO meta (key, value) VALUES ('audit.imported', ?)", [now()]);
    });
  })().catch(e => { _auditImported = null; throw e; });
  return _auditImported;
}

function insertAudit(q, e) {
  const { at, orgId, actorId, action, detail, ...rest } = e;
  return q.run('INSERT INTO audit (at, org_id, actor_id, action, detail, data) VALUES (?,?,?,?,?,?)',
    [at || now(), orgId || null, actorId || null, action || null, detail == null ? null : String(detail), Object.keys(rest).length ? JSON.stringify(rest) : null]);
}

/** Record one action. Never throws and never waits: the audit must not break what it records. */
function audit(entry) {
  const e = { at: now(), ...entry };
  auditImported().then(() => insertAudit(db(), e)).catch(err => console.warn(`[audit] not recorded: ${err.message}`));
}

/** The last n entries, newest last. */
async function auditTail(n = 100) {
  await auditImported();
  const rows = await db().all("SELECT at, org_id, actor_id, action, detail, data FROM audit WHERE tenant_id = 'local' ORDER BY at DESC, id DESC LIMIT ?", [Math.max(1, Number(n) || 100)]);
  return rows.reverse().map(r => ({ at: r.at, ...(r.org_id ? { orgId: r.org_id } : {}), ...(r.actor_id ? { actorId: r.actor_id } : {}),
    action: r.action, ...(r.detail != null ? { detail: r.detail } : {}), ...(r.data ? JSON.parse(r.data) : {}) }));
}

module.exports = {
  userCount, userById, userByEmail, createUser, updateUser,
  defaultOrg, createOrg, membership, membershipsOf, addMembership,
  createSession, sessionByHash, updateSession, deleteSession, deleteSessionsOf, pruneSessions,
  audit, auditTail,
  _resetAuditImport: () => { _auditImported = null; },   // tests only
};
