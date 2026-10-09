'use strict';

/**
 * A second path for backups (modules/backup/mirror.js; the owner, 2026-10-09): checked writable when saved, every
 * backup copied there — by hand or on the schedule — keeping as many scheduled ones there as the schedule keeps here,
 * and a failed copy is a line and a notice, never a failed backup.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const fs = require('fs');
const path = require('path');

const MIRROR = path.join(H.tmp, 'second-disk', 'doca-backups');
const dBacs = dir => fs.readdirSync(dir).filter(n => n.endsWith('.dBac'));

test.before(async () => {
  await H.start();
  // Backups are password-protected by default: a remembered one makes them (backup/secret.js), here and on the schedule.
  await H.api(null, 'POST', '/api/backups/settings', { encrypt: true, password: 'mirror test password' });
});
test.after(() => H.stop());

test('the second path is checked when saved: a whole folder, writable, not the backups folder', async () => {
  assert.match((await H.api(null, 'POST', '/api/backups/mirror', { dir: 'relative/path' })).body.error, /whole folder path/);
  assert.match((await H.api(null, 'POST', '/api/backups/mirror', { dir: require('../modules/paths').BACKUP_DIR })).body.error, /backups folder itself/);
  const file = path.join(H.tmp, 'a-file');
  fs.writeFileSync(file, 'x');
  assert.match((await H.api(null, 'POST', '/api/backups/mirror', { dir: path.join(file, 'below') })).body.error, /cannot be written/);
  const ok = await H.api(null, 'POST', '/api/backups/mirror', { dir: MIRROR });
  assert.equal(ok.status, 200); assert.equal(ok.body.dir, MIRROR);
  assert.ok(fs.existsSync(MIRROR), 'made when missing');
  assert.equal(require('../modules/settings-schema').unproposable('backup.mirror'), 'backup.mirror', 'never the agent\'s to propose');
  assert.equal((await H.api(null, 'GET', '/api/backups')).body.mirror.dir, MIRROR);
});

test('every backup is copied; the scheduled ones there keep the same number as here', async () => {
  const made = await H.api(null, 'POST', '/api/backups', {});
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.mirror.copied, made.body.name);
  assert.ok(fs.existsSync(path.join(MIRROR, made.body.name)));
  const schedule = require('../modules/backup/schedule');
  schedule.setConfig({ every: 'daily', at: '03:00', keep: 2 });
  for (let i = 0; i < 3; i++) {
    const r = await schedule.run({ now: Date.now() + i * 1000 });
    assert.ok(r.made && r.mirror?.copied, JSON.stringify(r));
    await new Promise(x => setTimeout(x, 1100));   // distinct names and times
  }
  const autos = dBacs(MIRROR).filter(n => n.startsWith('auto-'));
  assert.equal(autos.length, 2, 'the last 2 scheduled ones');
  assert.ok(dBacs(MIRROR).includes(made.body.name), 'one made by hand is never pruned');
  schedule.setConfig({ every: 'off' });
});

test('a copy that fails is a line and a notice; the backup stands', async () => {
  fs.rmSync(MIRROR, { recursive: true, force: true });
  fs.writeFileSync(MIRROR, 'the disk is gone, a file is in its place');
  const made = await H.api(null, 'POST', '/api/backups', {});
  assert.equal(made.status, 200, 'the backup is made');
  assert.ok(made.body.mirror.error, 'the copy says it failed');
  assert.ok(fs.existsSync(path.join(require('../modules/paths').BACKUP_DIR, made.body.name)));
  assert.ok(require('../modules/notices').list(null, true).some(n => /second copy failed/.test(n.title)));
  assert.ok(require('../modules/activity').list({ limit: 50 }).some(l => l.from === 'backup' && /second copy/.test(l.what)));
  assert.match((await H.api(null, 'GET', '/api/backups')).body.mirror.lastError, /.+/);
  assert.equal((await H.api(null, 'POST', '/api/backups/mirror', { dir: '' })).body.dir, '', 'switched off');
});
