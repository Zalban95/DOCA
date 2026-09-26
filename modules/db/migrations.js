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
];

async function migrate(d) {
  // Postgres spells an auto-numbered key differently; the rest of the SQL is shared.
  const fix = sql => (d.kind === 'postgres' ? sql.replace('id INTEGER PRIMARY KEY', 'id BIGSERIAL PRIMARY KEY') : sql);
  await d.run('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, what TEXT, at TEXT)');
  const done = new Set((await d.all('SELECT id FROM schema_migrations')).map(r => Number(r.id)));
  for (const s of STEPS) {
    if (done.has(s.id)) continue;
    await d.tx(async q => {
      for (const sql of s.sql) await q.run(fix(sql));
      await q.run('INSERT INTO schema_migrations (id, what, at) VALUES (?, ?, ?)', [s.id, s.what, new Date().toISOString()]);
    });
  }
}

module.exports = { migrate, STEPS };
