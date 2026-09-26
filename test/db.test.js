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
  assert.deepEqual(migrations.map(r => Number(r.id)), [1]);
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
