'use strict';

/**
 * Accounts in the database (auth phase 2, decided 2026-10-04): users,
 * organisations, memberships and sessions as tables, the same queries as
 * accounts-json.js and proven by the same contract (test/auth-store.test.js).
 *
 * Synchronous, on node:sqlite's handle — the gate reads accounts on every
 * request and every caller expects a value, not a promise (db/docs.js made the
 * same choice for conversations). The columns are what a query looks things up
 * by; `data` is the whole record, so a field added later needs no migration.
 * The JSON files under DATA_DIR/auth/ are imported once and left on disk.
 */
const crypto = require('crypto');
const store = require('../store');

const T = "tenant_id = 'local'";
const now = () => new Date().toISOString();
const id = prefix => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const bad = (m, status) => Object.assign(new Error(m), { status });
const parse = row => (row ? JSON.parse(row.data) : null);

// Not cached: a restore closes the database and reopens the restored file, and a held handle would be closed.
const _imported = new WeakSet();
function h() {
  const raw = require('../db').syncHandle();
  if (!raw) throw new Error('Accounts in SQL need SQLite; with PostgreSQL they stay in files (accounts-json.js).');
  if (!_imported.has(raw)) { importOnce(raw); _imported.add(raw); }
  return raw;
}

/** The JSON documents, copied in once under the write lock (another process may be doing the same). */
function importOnce(raw) {
  const done = () => raw.prepare("SELECT 1 FROM meta WHERE key = 'imported:auth'").get();
  if (done()) return;
  raw.exec('BEGIN IMMEDIATE');
  try {
    if (!done()) {
      const users = store.readJson('auth/users', {}), orgs = store.readJson('auth/orgs', {});
      const memberships = store.readJson('auth/memberships', []), sessions = store.readJson('auth/sessions', {});
      for (const u of Object.values(users)) raw.prepare('INSERT OR IGNORE INTO users (id, email, created_at, data) VALUES (?,?,?,?)').run(u.id, u.email, u.createdAt || null, JSON.stringify(u));
      for (const o of Object.values(orgs)) raw.prepare('INSERT OR IGNORE INTO orgs (id, created_at, data) VALUES (?,?,?)').run(o.id, o.createdAt || null, JSON.stringify(o));
      for (const m of memberships) raw.prepare('INSERT OR IGNORE INTO memberships (org_id, user_id, role, status, data) VALUES (?,?,?,?,?)').run(m.orgId, m.userId, m.role, m.status, JSON.stringify(m));
      for (const [hash, s] of Object.entries(sessions)) raw.prepare('INSERT OR IGNORE INTO sessions (token_hash, user_id, device_id, expires_at, data) VALUES (?,?,?,?,?)').run(hash, s.userId || null, s.deviceId || null, s.expiresAt || null, JSON.stringify(s));
      raw.prepare("INSERT INTO meta (key, value) VALUES ('imported:auth', ?)").run(now());
    }
    raw.exec('COMMIT');
  } catch (e) { raw.exec('ROLLBACK'); throw e; }
}

/* ── Users ─────────────────────────────────────────────── */

function userCount() { return Number(h().prepare(`SELECT count(*) AS n FROM users WHERE ${T}`).get().n); }
function userById(userId) { return parse(h().prepare(`SELECT data FROM users WHERE ${T} AND id = ?`).get(String(userId))); }

/** Case-insensitive: nobody remembers how they capitalised their address. */
function userByEmail(email) {
  return parse(h().prepare(`SELECT data FROM users WHERE ${T} AND email = ?`).get(String(email || '').trim().toLowerCase()));
}

function createUser({ email, name = '', passwordHash, mustChangePassword = false }) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) throw bad('An email is required.', 400);
  if (userByEmail(e)) throw bad('That email already has an account.', 409);
  const u = { id: id('usr'), email: e, name: String(name).trim(), passwordHash, mustChangePassword, createdAt: now() };
  h().prepare('INSERT INTO users (id, email, created_at, data) VALUES (?,?,?,?)').run(u.id, u.email, u.createdAt, JSON.stringify(u));
  return u;
}

function updateUser(userId, patch) {
  const cur = userById(userId);
  if (!cur) return null;
  const next = { ...cur, ...patch, id: userId };
  h().prepare(`UPDATE users SET email = ?, data = ? WHERE ${T} AND id = ?`).run(next.email, JSON.stringify(next), userId);
  return next;
}

/** Every account, oldest first (the Users page). */
function listUsers() { return h().prepare(`SELECT data FROM users WHERE ${T} ORDER BY created_at, rowid`).all().map(parse); }

/* ── Organisations and memberships ─────────────────────── */

function defaultOrg() { return parse(h().prepare(`SELECT data FROM orgs WHERE ${T} ORDER BY created_at, rowid LIMIT 1`).get()); }

function createOrg(name) {
  const o = { id: id('org'), name: String(name || 'DOCA'), createdAt: now() };
  h().prepare('INSERT INTO orgs (id, created_at, data) VALUES (?,?,?)').run(o.id, o.createdAt, JSON.stringify(o));
  return o;
}

function membership(orgId, userId) {
  return parse(h().prepare(`SELECT data FROM memberships WHERE ${T} AND org_id = ? AND user_id = ?`).get(String(orgId), String(userId)));
}

function membershipsOf(userId) {
  return h().prepare(`SELECT data FROM memberships WHERE ${T} AND user_id = ?`).all(String(userId)).map(parse);
}

function addMembership({ orgId, userId, role, status = 'active', approvedBy = null }) {
  const m = { orgId, userId, role, status, approvedBy, approvedAt: status === 'active' ? now() : null, createdAt: now() };
  h().prepare('INSERT OR REPLACE INTO memberships (org_id, user_id, role, status, data) VALUES (?,?,?,?,?)').run(orgId, userId, role, status, JSON.stringify(m));
  return m;
}

/** Every membership of an organisation (the Users page). */
function membersOf(orgId) { return h().prepare(`SELECT data FROM memberships WHERE ${T} AND org_id = ?`).all(String(orgId)).map(parse); }

/* ── Sessions ──────────────────────────────────────────── */

function putSession(hash, s) {
  h().prepare('INSERT OR REPLACE INTO sessions (token_hash, user_id, device_id, expires_at, data) VALUES (?,?,?,?,?)')
    .run(hash, s.userId || null, s.deviceId || null, s.expiresAt || null, JSON.stringify(s));
  return s;
}

function createSession(tokenHash, rec) { return putSession(tokenHash, { ...rec, createdAt: now(), lastSeenAt: now() }); }
function sessionByHash(tokenHash) { return parse(h().prepare(`SELECT data FROM sessions WHERE ${T} AND token_hash = ?`).get(String(tokenHash))); }

function updateSession(tokenHash, patch) {
  const cur = sessionByHash(tokenHash);
  return cur ? putSession(tokenHash, { ...cur, ...patch }) : null;
}

function deleteSession(tokenHash) { h().prepare(`DELETE FROM sessions WHERE ${T} AND token_hash = ?`).run(String(tokenHash)); }

/** Sign a user out everywhere, except (optionally) the session asking. */
function deleteSessionsOf(userId, except = null) {
  h().prepare(`DELETE FROM sessions WHERE ${T} AND user_id = ? AND token_hash <> ?`).run(String(userId), String(except ?? ''));
}

/** End every panel session a device's token opened (a disconnect; the device stays paired). */
function deleteSessionsOfDevice(deviceId) {
  return Number(h().prepare(`DELETE FROM sessions WHERE ${T} AND device_id = ?`).run(String(deviceId)).changes);
}

function pruneSessions() { h().prepare(`DELETE FROM sessions WHERE ${T} AND expires_at < ?`).run(now()); }

/** A user's sessions (the Users page: where someone is signed in). */
function sessionsOf(userId) {
  return h().prepare(`SELECT token_hash, data FROM sessions WHERE ${T} AND user_id = ?`).all(String(userId)).map(r => ({ tokenHash: r.token_hash, ...JSON.parse(r.data) }));
}

module.exports = {
  userCount, userById, userByEmail, createUser, updateUser, listUsers,
  defaultOrg, createOrg, membership, membershipsOf, addMembership, membersOf,
  createSession, sessionByHash, updateSession, deleteSession, deleteSessionsOf, deleteSessionsOfDevice, pruneSessions, sessionsOf,
};
