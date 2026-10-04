'use strict';

/**
 * Accounts as JSON documents under DATA_DIR/auth/ — the first implementation of
 * auth/store.js's queries, kept for PostgreSQL installs until the database's
 * asynchronous path exists (as conversations do, db/docs.js). Moved out of
 * store.js unchanged; accounts-sql.js is the other implementation, and
 * test/auth-store.test.js is the contract both pass.
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

/** End every panel session a device's token opened (a disconnect; the device stays paired). */
function deleteSessionsOfDevice(deviceId) {
  const all = read('sessions', {});
  let n = 0;
  for (const [h, s] of Object.entries(all)) if (s.deviceId === deviceId) { delete all[h]; n++; }
  if (n) write('sessions', all);
  return n;
}

function pruneSessions() {
  const all = read('sessions', {}), t = Date.now();
  let changed = false;
  for (const [h, s] of Object.entries(all)) if (Date.parse(s.expiresAt) < t) { delete all[h]; changed = true; }
  if (changed) write('sessions', all);
}

function listUsers() { return Object.values(read('users', {})).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))); }
function membersOf(orgId) { return read('memberships', []).filter(m => m.orgId === orgId); }
function sessionsOf(userId) { return Object.entries(read('sessions', {})).filter(([, s]) => s.userId === userId).map(([tokenHash, s]) => ({ tokenHash, ...s })); }

module.exports = {
  listUsers, membersOf, sessionsOf,
  userCount, userById, userByEmail, createUser, updateUser,
  defaultOrg, createOrg, membership, membershipsOf, addMembership,
  createSession, sessionByHash, updateSession, deleteSession, deleteSessionsOf, deleteSessionsOfDevice, pruneSessions,
};
