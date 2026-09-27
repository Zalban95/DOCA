'use strict';

/**
 * The data layer (modules/db, docs/design/database.md): SQLite by default,
 * migrations once, the old usage files imported once, a consistent snapshot.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H     = require('./helpers');
const store = require('../modules/store');

test.before(() => H.start());
test.after(() => H.stop());

test('the usage ledger moves into the database: old monthly files imported once, new calls recorded, summed', async () => {
  // Written the way versions before 2.107.0 wrote the ledger, before anything opens the database.
  const at = new Date(Date.now() - 3600e3).toISOString();
  fs.writeFileSync(path.join(store.dir('harness/usage'), `${at.slice(0, 7)}.jsonl`),
    `${JSON.stringify({ at, kind: 'turn', provider: 'old', model: 'm', prompt: 100, completion: 10, cached: 50, source: 'provider' })}\n`);
  const db = require('../modules/db');
  const usage = require('../modules/harness/usage');
  const s1 = await usage.summary({ days: 1, by: 'model' });
  assert.equal(s1.rows.find(r => r.key === 'old/m')?.prompt, 100, 'the old file was imported');

  usage.record({ kind: 'turn', provider: 'new', model: 'n', usage: { prompt_tokens: 40, completion_tokens: 4 } });
  const s2 = await usage.summary({ days: 1, by: 'model' });
  assert.equal(s2.rows.find(r => r.key === 'old/m')?.prompt, 100, 'imported once, not twice');
  assert.deepEqual(s2.rows.find(r => r.key === 'new/n'), { key: 'new/n', calls: 1, prompt: 40, completion: 4, cached: 0, estimated: 0 });

  const migrations = await db.all('SELECT id FROM schema_migrations');
  assert.deepEqual(migrations.map(r => Number(r.id)), [1, 2]);
  const snap = await db.snapshot(path.join(H.tmp, 'snap.db'));
  assert.ok(fs.statSync(snap).size > 0, 'a consistent copy for backups');
  assert.equal(db.kind, 'sqlite');
});

test('a backup carries a consistent copy of the database, never its live side files', async () => {
  const archive = require('../modules/backup/archive');
  const made = await archive.create({ dir: path.join(H.tmp, 'bk') });
  const opened = await archive.open(made.file);
  const names = opened.manifest.contents.map(c => c.path);
  assert.ok(names.includes('data/doca.db'), names.join(', '));
  assert.ok(!names.some(n => /doca\.db-(wal|shm)$/.test(n)));
  assert.ok(!fs.readdirSync(store.DATA_DIR).some(n => n.includes('.doca.db.backup-')), 'the snapshot is cleaned up');
});

test('two processes opening the database at once import the old ledger once', async () => {
  const { spawn } = require('node:child_process');
  const dir = path.join(H.tmp, 'race');
  fs.mkdirSync(path.join(dir, 'harness', 'usage'), { recursive: true });
  const at = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'harness', 'usage', `${at.slice(0, 7)}.jsonl`),
    Array.from({ length: 300 }, (_, i) => JSON.stringify({ at, kind: 'turn', provider: 'p', model: 'm', prompt: i, completion: 1, source: 'provider' })).join('\n') + '\n');
  const run = () => new Promise(resolve => {
    const c = spawn(process.execPath, ['-e', "require('./modules/harness/usage').summary({ days: 1 }).then(s => { console.log(s.total.calls); require('./modules/db').close(); })"],
      { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCA_DATA_DIR: dir } });
    let out = ''; c.stdout.on('data', d => { out += d; }); c.on('exit', () => resolve(out.trim()));
  });
  const [a, b] = await Promise.all([run(), run()]);
  assert.deepEqual([a, b], ['300', '300'], 'each sees the 300 rows once');
});

test('conversations and memory live in the database; files from before are imported once, and a deleted one stays deleted', () => {
  const memory = require('../modules/harness/memory');
  const docs = require('../modules/db/docs');
  // A transcript as versions before 2.111.0 wrote it, for a conversation the index does not know yet.
  const id = 's_legacy1';
  const file = path.join(store.dir('harness/sessions'), `${id}.jsonl`);
  fs.writeFileSync(file, `${JSON.stringify({ role: 'user', content: 'from the file era', at: '2026-09-01T00:00:00Z' })}\n`);
  assert.deepEqual(memory.messages(id).map(r => r.content), ['from the file era'], 'imported on first read');
  docs.append(`transcript:${id}`, file, { role: 'assistant', content: 'and a new line' });
  assert.deepEqual(memory.messages(id).map(r => r.content), ['from the file era', 'and a new line'], 'imported once, appended after');
  assert.equal(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 1, 'the new line went to the database, not the file');

  const s = memory.createSession('in the database', { activate: false });
  memory.append(s.id, { role: 'user', content: 'hello' });
  const raw = require('../modules/db').syncHandle();
  assert.ok(raw.prepare("SELECT 1 FROM docs WHERE key = 'harness/sessions'").get(), 'the index is a document in the database');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM lines WHERE key = ?').get(`transcript:${s.id}`).n, 1);
  memory.deleteSession(s.id);
  assert.deepEqual(memory.messages(s.id), [], 'deleted, and not brought back from a file');

  memory.memWrite({ key: 'db-probe', value: 'kept in the database' });
  assert.ok(raw.prepare("SELECT value FROM docs WHERE key = 'harness/memory'").get().value.includes('db-probe'));
  memory.memForget('db-probe');
});
