'use strict';

/**
 * This machine's files, backed up — against a real restic, in temporary folders only (skipped where restic is absent):
 * set up with a password made once, a backup with a file it cannot read, the history, one folder level of a snapshot,
 * finding a file, downloading a file and a folder, restoring beside / to / in place, a new password, joining with the
 * wrong one and the right one, bringing a home back on a "fresh install", and that the password is in no file DOCA
 * wrote except the keys file.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// The person's home is a temporary folder here: nothing in this file may read or write the real one.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-mb-'));
process.env.HOME = path.join(ROOT, 'home');
process.env.USERPROFILE = process.env.HOME;
process.on('exit', () => { try { fs.chmodSync(path.join(ROOT, 'home', 'Documents', 'locked.txt'), 0o600); } catch { /* gone */ } try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* temp */ } });

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const restic = require('../modules/machine-backup/restic');

const HOME = process.env.HOME, REPO = path.join(ROOT, 'disk', 'repo');
const DOCS = path.join(HOME, 'Documents'), PICS = path.join(HOME, 'Pictures');
const has = !!restic.bin();
const opts = { skip: has ? false : 'restic is not installed here' };
let password = null;

async function waitIdle() {
  for (let i = 0; i < 300; i++) {
    const s = await H.api(null, 'GET', '/api/machine-backup');
    if (!s.body.running) return s.body;
    await H.sleep(100);
  }
  throw new Error('the backup did not finish');
}

test.before(async () => {
  fs.mkdirSync(path.join(DOCS, 'tax'), { recursive: true });
  fs.mkdirSync(path.join(DOCS, 'node_modules', 'x'), { recursive: true });
  fs.mkdirSync(PICS, { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'disk'), { recursive: true });
  fs.writeFileSync(path.join(DOCS, 'thesis.md'), 'version one\n');
  fs.writeFileSync(path.join(DOCS, 'tax', '2025.txt'), 'paid\n');
  fs.writeFileSync(path.join(DOCS, 'node_modules', 'x', 'i.js'), 'left out\n');
  fs.writeFileSync(path.join(PICS, 'cat.bin'), Buffer.alloc(3000, 7));
  if (process.platform !== 'win32') { fs.writeFileSync(path.join(DOCS, 'locked.txt'), 'no'); fs.chmodSync(path.join(DOCS, 'locked.txt'), 0); }
  await H.start();
});
test.after(() => H.stop());

test('set up: the password is made and shown once, then kept only in the protected keys file', opts, async () => {
  const s = await H.api(null, 'POST', '/api/machine-backup/settings', { folders: [DOCS, PICS] });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.restic.found, true);
  const r = await H.api(null, 'POST', '/api/machine-backup/setup', { repo: REPO });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  password = r.body.password;
  assert.match(password, /^[a-z0-9]{5}(-[a-z0-9]{5}){5}$/);
  assert.ok(fs.existsSync(path.join(REPO, 'config')));
  const after = await H.api(null, 'GET', '/api/machine-backup');
  assert.equal(after.body.setUp, true);
  assert.equal(after.body.hasPassword, true);
  assert.ok(!JSON.stringify(after.body).includes(password), 'never handed back');
  const again = await H.api(null, 'POST', '/api/machine-backup/setup', { repo: REPO });
  assert.equal(again.status, 409, 'a second set-up over an existing backup is refused');
});

test('back up now: a snapshot with what it could not read, the history, a folder level, find, download', opts, async () => {
  const r = await H.api(null, 'POST', '/api/machine-backup/run', {});
  assert.equal(r.status, 202);
  const s = await waitIdle();
  assert.equal(s.lastRun.ok, true, JSON.stringify(s.lastRun));
  assert.ok(s.lastRun.snapshotId);
  if (process.platform !== 'win32' && process.getuid?.() !== 0) assert.equal(s.lastRun.errorCount, 1, 'the unreadable file is counted, the rest backed up');
  const h = await H.api(null, 'GET', '/api/machine-backup/history');
  assert.equal(h.body.snapshots.length, 1);
  const snap = h.body.snapshots[0];
  assert.equal(snap.home, HOME);
  assert.deepEqual(snap.paths.sort(), [DOCS, PICS].sort());

  const top = await H.api(null, 'GET', `/api/machine-backup/browse?snapshot=${snap.id}`);
  assert.equal(top.body.entries.length, 2);
  const lvl = await H.api(null, 'GET', `/api/machine-backup/browse?snapshot=${snap.id}&path=${encodeURIComponent(DOCS)}`);
  const names = lvl.body.entries.map(e => e.name);
  assert.ok(names.includes('thesis.md') && names.includes('tax'));
  assert.ok(!names.includes('node_modules'), 'left out by the default patterns');
  assert.ok(!lvl.body.entries.some(e => e.name === 'tax' && e.path.endsWith('2025.txt')), 'one level only');

  const f = await H.api(null, 'GET', '/api/machine-backup/find?q=thesis');
  assert.equal(f.body.total, 1);
  assert.equal(f.body.matches[0].path, path.join(DOCS, 'thesis.md'));

  const file = await H.api(null, 'GET', `/api/machine-backup/download?snapshot=${snap.id}&path=${encodeURIComponent(path.join(DOCS, 'thesis.md'))}`);
  assert.equal(String(file.body), 'version one\n');
  const zip = await H.api(null, 'GET', `/api/machine-backup/download?snapshot=${snap.id}&path=${encodeURIComponent(path.join(DOCS, 'tax'))}&dir=1`);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  assert.equal(Buffer.from(zip.body).subarray(0, 2).toString(), 'PK');
  assert.ok(Buffer.from(zip.body).includes(Buffer.from('2025.txt')));

  const tool = await require('../modules/harness/tools').call('machine_backup', { action: 'find', q: 'thesis' }, [], { user: null, sessionId: null });
  assert.match(tool, /1 copy of "thesis"/);
  assert.match(await require('../modules/harness/tools').call('machine_backup', { action: 'history' }, [], { user: null, sessionId: null }), /1 snapshots/);
});

test('restore: beside it by default, to a chosen folder, in its place over what is there', opts, async () => {
  const snap = (await H.api(null, 'GET', '/api/machine-backup/history')).body.snapshots[0].id;
  fs.writeFileSync(path.join(DOCS, 'thesis.md'), 'version two\n');
  const item = path.join(DOCS, 'thesis.md');
  const beside = await H.api(null, 'POST', '/api/machine-backup/restore', { snapshot: snap, path: item });
  assert.equal(beside.status, 200, JSON.stringify(beside.body));
  assert.equal(fs.readFileSync(path.join(beside.body.into, 'thesis.md'), 'utf8'), 'version one\n');
  assert.equal(fs.readFileSync(item, 'utf8'), 'version two\n', 'the file in place is untouched');
  const to = path.join(ROOT, 'elsewhere');
  const r2 = await H.api(null, 'POST', '/api/machine-backup/restore', { snapshot: snap, path: path.join(DOCS, 'tax'), mode: 'to', target: to });
  assert.equal(r2.status, 200);
  assert.equal(fs.readFileSync(path.join(to, 'tax', '2025.txt'), 'utf8'), 'paid\n');
  const r3 = await H.api(null, 'POST', '/api/machine-backup/restore', { snapshot: snap, path: item, mode: 'replace' });
  assert.equal(r3.status, 200);
  assert.equal(fs.readFileSync(item, 'utf8'), 'version one\n');
  assert.equal((await H.api(null, 'POST', '/api/machine-backup/restore', { snapshot: snap, path: '../etc' })).status, 400);
});

test('a new password: the old one no longer opens it; joining with the wrong one is refused, with the right one kept', opts, async () => {
  const r = await H.api(null, 'POST', '/api/machine-backup/password', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const next = r.body.password;
  assert.notEqual(next, password);
  const wrong = await H.api(null, 'POST', '/api/machine-backup/connect', { repo: REPO, password });
  assert.equal(wrong.status, 403);
  const right = await H.api(null, 'POST', '/api/machine-backup/connect', { repo: REPO, password: next });
  assert.equal(right.status, 200, JSON.stringify(right.body));
  password = next;
});

test('a fresh install: each folder of another home lands in this home by its role; nothing written outside it', opts, async () => {
  const restore = require('../modules/machine-backup/restore');
  const runner = require('../modules/machine-backup/runner');
  const old = path.join(ROOT, 'oldhome'), fresh = path.join(ROOT, 'freshhome');
  fs.mkdirSync(path.join(old, 'Movies'), { recursive: true });
  fs.writeFileSync(path.join(old, 'Movies', 'trip.bin'), 'film');
  await restic.run(runner.backupArgs({ paths: [path.join(old, 'Movies'), path.join(ROOT, 'disk')], home: old, platform: 'darwin', host: 'old-mac', exclude: ['repo'] }), { ok: [0, 3] });
  const snap = (await require('../modules/machine-backup/browse').snapshots()).find(s => s.host === 'old-mac');
  const r = await restore.home({ snapshot: snap.id }, null, { home: fresh, platform: 'linux' });
  assert.equal(fs.readFileSync(path.join(fresh, 'Videos', 'trip.bin'), 'utf8'), 'film', 'a Mac\'s Movies is a Linux Videos');
  assert.deepEqual(r.left, [path.join(ROOT, 'disk')], 'a folder that was not under that home has no place here until the person picks one');
});

test('the password is in no file DOCA wrote but the keys file', opts, () => {
  const dataDir = process.env.DOCA_DATA_DIR, keysFile = require('../modules/paths').MACHINE_BACKUP_KEYS_FILE;
  const hits = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'cache') walk(p); continue; }
    if (p === keysFile || p === `${keysFile}.prev`) continue;
    try { if (fs.readFileSync(p).includes(Buffer.from(password))) hits.push(p); } catch { /* unreadable */ }
  } };
  walk(dataDir);
  walk(path.dirname(process.env.DOCA_PREFS_FILE));
  assert.deepEqual(hits.filter(p => !p.startsWith(REPO)), []);
  if (process.platform !== 'win32') assert.equal(fs.statSync(keysFile).mode & 0o777, 0o600);
  assert.ok(require('../modules/paths').PROTECTED_FILES.includes(keysFile));
});
