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
 * The audit log, one file a month (audit-YYYY-MM.jsonl), so it never grows
 * without end and an old month can be archived or removed on its own. The
 * single audit.jsonl it used to be is kept as it is and read as the oldest.
 */
const AUDIT_LEGACY = 'audit.jsonl';
const auditFile = (at = now()) => `audit-${at.slice(0, 7)}.jsonl`;

function audit(entry) {
  const at = now();
  store.appendJsonl(path.join(store.dir('auth'), auditFile(at)), { at, ...entry });
}

/** The last n entries, newest last, across months. */
function auditTail(n = 100) {
  const dir = store.dir('auth');
  const months = require('fs').readdirSync(dir).filter(f => /^audit-\d{4}-\d{2}\.jsonl$/.test(f)).sort().reverse();
  let out = [];
  for (const f of [...months, AUDIT_LEGACY]) {
    out = [...store.readJsonl(path.join(dir, f)), ...out];
    if (out.length >= n) break;
  }
  return out.slice(-n);
}

module.exports = {
  userCount, userById, userByEmail, createUser, updateUser,
  defaultOrg, createOrg, membership, membershipsOf, addMembership,
  createSession, sessionByHash, updateSession, deleteSession, deleteSessionsOf, pruneSessions,
  audit, auditTail,
};
