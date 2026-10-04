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
const path   = require('path');
const store  = require('../store');

// Accounts — users, organisations, memberships, sessions — from one implementation or the other: the
// database when it is SQLite (accounts-sql.js), the JSON files otherwise (accounts-json.js). Same queries.
const accounts = () => require('./accounts-backend').get();
const now = () => new Date().toISOString();

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

const ACCOUNT_QUERIES = ['userCount', 'userById', 'userByEmail', 'createUser', 'updateUser',
  'defaultOrg', 'createOrg', 'membership', 'membershipsOf', 'addMembership',
  'createSession', 'sessionByHash', 'updateSession', 'deleteSession', 'deleteSessionsOf', 'deleteSessionsOfDevice', 'pruneSessions'];

module.exports = {
  ...Object.fromEntries(ACCOUNT_QUERIES.map(q => [q, (...a) => accounts()[q](...a)])),
  audit, auditTail,
  _resetAuditImport: () => { _auditImported = null; },   // tests only
};
