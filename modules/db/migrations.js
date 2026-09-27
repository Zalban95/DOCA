'use strict';

/**
 * The schema, one numbered step at a time (docs/design/database.md). A step runs
 * once and is recorded in schema_migrations. Written in the SQL both SQLite and
 * PostgreSQL accept; every table carries tenant_id for a hosted database.
 */
const STEPS = [
  { id: 1, what: 'the usage ledger and the audit log', sql: [
    `CREATE TABLE IF NOT EXISTS usage (
       id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'local', at TEXT NOT NULL,
       kind TEXT, provider TEXT, model TEXT, session_id TEXT, agent TEXT,
       prompt INTEGER NOT NULL DEFAULT 0, completion INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0,
       source TEXT)`,
    'CREATE INDEX IF NOT EXISTS usage_at ON usage (tenant_id, at)',
    `CREATE TABLE IF NOT EXISTS audit (
       id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'local', at TEXT NOT NULL,
       org_id TEXT, actor_id TEXT, action TEXT, detail TEXT, data TEXT)`,
    'CREATE INDEX IF NOT EXISTS audit_at ON audit (tenant_id, at)',
    'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)',
  ] },
  { id: 2, what: 'documents and lines: conversations, their index, memory', sql: [
    `CREATE TABLE IF NOT EXISTS docs (
       tenant_id TEXT NOT NULL DEFAULT 'local', key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT,
       PRIMARY KEY (tenant_id, key))`,
    `CREATE TABLE IF NOT EXISTS lines (
       id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'local', key TEXT NOT NULL, value TEXT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS lines_key ON lines (tenant_id, key, id)',
  ] },
];

/** The same steps on a synchronous SQLite handle (node:sqlite), for the stores that must stay synchronous. */
function migrateSync(raw) {
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, what TEXT, at TEXT)');
  const done = new Set(raw.prepare('SELECT id FROM schema_migrations').all().map(r => Number(r.id)));
  for (const s of STEPS) {
    if (done.has(s.id)) continue;
    raw.exec('BEGIN IMMEDIATE');
    try {
      for (const sql of s.sql) raw.exec(sql);
      raw.prepare('INSERT INTO schema_migrations (id, what, at) VALUES (?, ?, ?)').run(s.id, s.what, new Date().toISOString());
      raw.exec('COMMIT');
    } catch (e) { raw.exec('ROLLBACK'); if (!/UNIQUE constraint/.test(e.message)) throw e; }   // another process migrated first
  }
}

async function migrate(d) {
  // Postgres spells an auto-numbered key differently; the rest of the SQL is shared.
  const fix = sql => (d.kind === 'postgres' ? sql.replace('id INTEGER PRIMARY KEY', 'id BIGSERIAL PRIMARY KEY') : sql);
  await d.run('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, what TEXT, at TEXT)');
  const done = new Set((await d.all('SELECT id FROM schema_migrations')).map(r => Number(r.id)));
  for (const s of STEPS) {
    if (done.has(s.id)) continue;
    await d.tx(async q => {
      // Checked again under the write lock: another process may have run this step since we looked.
      if (await q.get('SELECT 1 AS x FROM schema_migrations WHERE id = ?', [s.id])) return;
      for (const sql of s.sql) await q.run(fix(sql));
      await q.run('INSERT INTO schema_migrations (id, what, at) VALUES (?, ?, ?)', [s.id, s.what, new Date().toISOString()]);
    });
  }
}

module.exports = { migrate, migrateSync, STEPS };
