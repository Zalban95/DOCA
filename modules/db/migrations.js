'use strict';

/**
 * The schema, one numbered step at a time (docs/design/database.md). A step runs
 * once and is recorded in schema_migrations. Written in the SQL both SQLite and
 * PostgreSQL accept; every table carries tenant_id for a hosted database.
 *
 * Each step names the feature its tables belong to (modules/features, whose entry lists them in `tables`): a step of a
 * feature this hive is not licensed for is not run, so its tables are not made. Steps are recorded one by one, so a
 * licence that adds the feature later makes them at that start; one that drops it leaves them as they are, unused.
 */
const STEPS = [
  { id: 1, feature: 'harness', what: 'the usage ledger and the audit log', sql: [
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
  { id: 2, feature: 'harness', what: 'documents and lines: conversations, their index, memory', sql: [
    `CREATE TABLE IF NOT EXISTS docs (
       tenant_id TEXT NOT NULL DEFAULT 'local', key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT,
       PRIMARY KEY (tenant_id, key))`,
    `CREATE TABLE IF NOT EXISTS lines (
       id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'local', key TEXT NOT NULL, value TEXT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS lines_key ON lines (tenant_id, key, id)',
  ] },
  // Auth phase 2 (docs/design/permissions.md): the keys a query uses are columns, the whole record is `data`.
  { id: 3, feature: 'users', what: 'accounts: users, organisations, memberships, sessions', sql: [
    `CREATE TABLE IF NOT EXISTS users (
       tenant_id TEXT NOT NULL DEFAULT 'local', id TEXT NOT NULL, email TEXT NOT NULL, created_at TEXT, data TEXT NOT NULL,
       PRIMARY KEY (tenant_id, id))`,
    'CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (tenant_id, email)',
    `CREATE TABLE IF NOT EXISTS orgs (
       tenant_id TEXT NOT NULL DEFAULT 'local', id TEXT NOT NULL, created_at TEXT, data TEXT NOT NULL,
       PRIMARY KEY (tenant_id, id))`,
    `CREATE TABLE IF NOT EXISTS memberships (
       tenant_id TEXT NOT NULL DEFAULT 'local', org_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT, status TEXT, data TEXT NOT NULL,
       PRIMARY KEY (tenant_id, org_id, user_id))`,
    'CREATE INDEX IF NOT EXISTS memberships_user ON memberships (tenant_id, user_id)',
    `CREATE TABLE IF NOT EXISTS sessions (
       tenant_id TEXT NOT NULL DEFAULT 'local', token_hash TEXT NOT NULL, user_id TEXT, device_id TEXT, expires_at TEXT, data TEXT NOT NULL,
       PRIMARY KEY (tenant_id, token_hash))`,
    'CREATE INDEX IF NOT EXISTS sessions_user ON sessions (tenant_id, user_id)',
    'CREATE INDEX IF NOT EXISTS sessions_device ON sessions (tenant_id, device_id)',
  ] },
  { id: 4, feature: 'users', what: 'permission levels', sql: [
    `CREATE TABLE IF NOT EXISTS levels (
       tenant_id TEXT NOT NULL DEFAULT 'local', id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT, data TEXT NOT NULL,
       PRIMARY KEY (tenant_id, id))`,
  ] },
  { id: 5, feature: 'grants', what: 'grants: exceptions to a level, given by someone entitled to', sql: [
    `CREATE TABLE IF NOT EXISTS grants (
       tenant_id TEXT NOT NULL DEFAULT 'local', id TEXT NOT NULL, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL,
       permission TEXT NOT NULL, scope TEXT NOT NULL, by_kind TEXT NOT NULL, by_id TEXT NOT NULL, by_user TEXT,
       created_at TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, note TEXT,
       PRIMARY KEY (tenant_id, id))`,
    'CREATE INDEX IF NOT EXISTS grants_subject ON grants (tenant_id, subject_kind, subject_id)',
  ] },
  { id: 6, feature: 'harness', what: 'runs: one record of how each turn went', sql: [
    `CREATE TABLE IF NOT EXISTS runs (
       tenant_id TEXT NOT NULL DEFAULT 'local', id TEXT NOT NULL, kind TEXT NOT NULL, session_id TEXT, mission_id TEXT,
       person_id TEXT, state TEXT NOT NULL, outcome TEXT, steps INTEGER, tokens INTEGER, plan_check TEXT,
       started_at TEXT NOT NULL, ended_at TEXT,
       PRIMARY KEY (tenant_id, id))`,
    'CREATE INDEX IF NOT EXISTS runs_session ON runs (tenant_id, session_id, started_at)',
    'CREATE INDEX IF NOT EXISTS runs_mission ON runs (tenant_id, mission_id)',
  ] },
  // A vector is base64 of its float32 bytes: one TEXT column both databases take; pgvector can replace it later.
  { id: 7, feature: 'retrieval', what: 'retrieval: embedded chunks of memory and conversations (retrieval/)', sql: [
    `CREATE TABLE IF NOT EXISTS embeddings (
       tenant_id TEXT NOT NULL DEFAULT 'local', source TEXT NOT NULL, ref TEXT NOT NULL, chunk INTEGER NOT NULL,
       hash TEXT NOT NULL, text TEXT NOT NULL, model TEXT NOT NULL, dims INTEGER NOT NULL, vec TEXT NOT NULL, updated_at TEXT NOT NULL,
       PRIMARY KEY (tenant_id, source, model, ref, chunk))`,
  ] },
  { id: 8, feature: 'traces', what: 'traces: what each turn did, step by step (harness/trace.js)', sql: [
    `CREATE TABLE IF NOT EXISTS trace_spans (
       tenant_id TEXT NOT NULL DEFAULT 'local', run_id TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL,
       kind TEXT NOT NULL, name TEXT, step INTEGER, ms INTEGER, data TEXT,
       PRIMARY KEY (tenant_id, run_id, seq))`,
    'CREATE INDEX IF NOT EXISTS trace_spans_at ON trace_spans (tenant_id, at)',
  ] },
  // A run that is not a turn (a device's command job, api-v1/jobs.js) keeps what it was in `detail` (JSON).
  { id: 9, feature: 'harness', what: 'runs: a detail column, so command jobs are runs too (TODO H11.2)', sql: [
    'ALTER TABLE runs ADD COLUMN detail TEXT',
  ] },
  // A secret handed to a device's input (modules/sealed, CONSTITUTION S4): the value only as AES-256-GCM ciphertext,
  // whose key stays in DATA_DIR/keys — a copy of this database alone reveals nothing. Uses are a record, never a value.
  { id: 10, feature: 'sealed-secrets', what: 'sealed secrets for devices, and where each was used (sealed/)', sql: [
    `CREATE TABLE IF NOT EXISTS sealed_secrets (
       tenant_id TEXT NOT NULL DEFAULT 'local', name TEXT NOT NULL, origin TEXT, note TEXT, owner_id TEXT,
       iv TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL,
       PRIMARY KEY (tenant_id, name))`,
    `CREATE TABLE IF NOT EXISTS sealed_uses (
       id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'local', at TEXT NOT NULL, secret TEXT NOT NULL,
       device_id TEXT, device_name TEXT, target TEXT, uses INTEGER, by_user TEXT, session_id TEXT, outcome TEXT)`,
    'CREATE INDEX IF NOT EXISTS sealed_uses_at ON sealed_uses (tenant_id, at)',
  ] },
  // Spending is a person's (spending/spent.js): who a call was for is kept on its row when it is written, so deleting
  // the conversation afterwards cannot make its spend nobody's (security review 2026-10-07). Older rows have none and
  // are attributed through their conversation, as before.
  { id: 11, feature: 'harness', what: 'usage: the person each call was for', sql: [
    'ALTER TABLE usage ADD COLUMN person_id TEXT',
  ] },
  // A person's own secrets for their own devices (TODO P1.3): a row is whose it is — '' the hub's, kept by its admins,
  // else a person's id — and a name is unique per owner, so the key gains `person_id`. SQLite cannot change a primary
  // key in place, so the table is rebuilt; every existing row is the hub's, as it was.
  { id: 12, feature: 'sealed-secrets', what: 'sealed secrets: whose each is (the hub\'s or a person\'s own)', sql: [
    `CREATE TABLE IF NOT EXISTS sealed_secrets_v2 (
       tenant_id TEXT NOT NULL DEFAULT 'local', person_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, origin TEXT, note TEXT,
       owner_id TEXT, iv TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL,
       PRIMARY KEY (tenant_id, person_id, name))`,
    `INSERT INTO sealed_secrets_v2 (tenant_id, person_id, name, origin, note, owner_id, iv, data, created_at)
       SELECT tenant_id, '', name, origin, note, owner_id, iv, data, created_at FROM sealed_secrets`,
    'DROP TABLE sealed_secrets',
    'ALTER TABLE sealed_secrets_v2 RENAME TO sealed_secrets',
  ] },
  // The Library (library/, experiment library): a row per file of the folders the owner chose — size and modified time
  // as BIGINT, since a video passes 2 GB and a time in ms passes 2^31 — and a row per piece with its vector, as
  // `embeddings` keeps them. `at_sec`/`end_sec` are where in a recording a piece is (a frame, a window, words said).
  { id: 13, feature: 'library', what: 'the Library: files of this machine indexed by meaning, and their pieces (library/)', sql: [
    `CREATE TABLE IF NOT EXISTS library_items (
       tenant_id TEXT NOT NULL DEFAULT 'local', path TEXT NOT NULL, folder TEXT NOT NULL, kind TEXT NOT NULL,
       size BIGINT, mtime_ms BIGINT, hash TEXT, model TEXT, state TEXT NOT NULL, note TEXT, meta TEXT, indexed_at TEXT,
       PRIMARY KEY (tenant_id, path))`,
    `CREATE TABLE IF NOT EXISTS library_pieces (
       tenant_id TEXT NOT NULL DEFAULT 'local', path TEXT NOT NULL, piece INTEGER NOT NULL, kind TEXT NOT NULL,
       at_sec REAL, end_sec REAL, text TEXT, model TEXT NOT NULL, dims INTEGER NOT NULL, vec TEXT NOT NULL,
       PRIMARY KEY (tenant_id, path, piece))`,
    'CREATE INDEX IF NOT EXISTS library_pieces_model ON library_pieces (tenant_id, model)',
  ] },
  // Hive chat (people/; docs/design/hive-chat.md): the people of a hive talking to each other. A space is a direct
  // conversation between two (`dm_key` the two ids sorted, unique), a group, or a channel of an organisation or a team
  // (`audience`). A message is numbered within its space (`seq`), so "read up to" is one number; a delete keeps the row
  // as a tombstone. `agent_session` is the conversation a person's own agent answers this space in, once brought in.
  { id: 14, feature: 'hive-chat', what: 'hive chat: spaces, members, messages, reactions and pins (people/)', sql: [
    `CREATE TABLE IF NOT EXISTS people_spaces (
       tenant_id TEXT NOT NULL DEFAULT 'local', id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT, topic TEXT, org_id TEXT,
       audience TEXT, dm_key TEXT, created_by TEXT, created_at TEXT NOT NULL, last_at TEXT, last_seq INTEGER NOT NULL DEFAULT 0,
       archived_at TEXT, PRIMARY KEY (tenant_id, id))`,
    'CREATE UNIQUE INDEX IF NOT EXISTS people_spaces_dm ON people_spaces (tenant_id, dm_key)',
    `CREATE TABLE IF NOT EXISTS people_members (
       tenant_id TEXT NOT NULL DEFAULT 'local', space_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
       joined_at TEXT NOT NULL, read_seq INTEGER NOT NULL DEFAULT 0, read_at TEXT, muted INTEGER NOT NULL DEFAULT 0,
       agent_session TEXT, PRIMARY KEY (tenant_id, space_id, user_id))`,
    'CREATE INDEX IF NOT EXISTS people_members_user ON people_members (tenant_id, user_id)',
    `CREATE TABLE IF NOT EXISTS people_messages (
       tenant_id TEXT NOT NULL DEFAULT 'local', id TEXT NOT NULL, space_id TEXT NOT NULL, seq INTEGER NOT NULL,
       author_id TEXT, agent TEXT, body TEXT NOT NULL, reply_to TEXT, mentions TEXT, attachments TEXT,
       created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT, PRIMARY KEY (tenant_id, id))`,
    'CREATE UNIQUE INDEX IF NOT EXISTS people_messages_seq ON people_messages (tenant_id, space_id, seq)',
    'CREATE INDEX IF NOT EXISTS people_messages_at ON people_messages (tenant_id, created_at)',
    `CREATE TABLE IF NOT EXISTS people_reactions (
       tenant_id TEXT NOT NULL DEFAULT 'local', message_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL, at TEXT NOT NULL,
       PRIMARY KEY (tenant_id, message_id, user_id, emoji))`,
    `CREATE TABLE IF NOT EXISTS people_pins (
       tenant_id TEXT NOT NULL DEFAULT 'local', space_id TEXT NOT NULL, message_id TEXT NOT NULL, by_user TEXT, at TEXT NOT NULL,
       PRIMARY KEY (tenant_id, space_id, message_id))`,
  ] },
];

const licensed = s => require('../license').featureOn(s.feature);

/** The same steps on a synchronous SQLite handle (node:sqlite), for the stores that must stay synchronous. */
function migrateSync(raw) {
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, what TEXT, at TEXT)');
  const done = new Set(raw.prepare('SELECT id FROM schema_migrations').all().map(r => Number(r.id)));
  for (const s of STEPS) {
    if (done.has(s.id) || !licensed(s)) continue;
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
    if (done.has(s.id) || !licensed(s)) continue;
    await d.tx(async q => {
      // Checked again under the write lock: another process may have run this step since we looked.
      if (await q.get('SELECT 1 AS x FROM schema_migrations WHERE id = ?', [s.id])) return;
      for (const sql of s.sql) await q.run(fix(sql));
      await q.run('INSERT INTO schema_migrations (id, what, at) VALUES (?, ?, ?)', [s.id, s.what, new Date().toISOString()]);
    });
  }
}

module.exports = { migrate, migrateSync, STEPS };
