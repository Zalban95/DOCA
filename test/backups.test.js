'use strict';

/**
 * .dBac backups: encrypted or open by the user's choice, everything in them,
 * and a restore that checks everything before it replaces anything.
 */
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

// A home of its own, before anything reads paths: backups and the remembered
// password live in DOCA_HOME, and this must never touch the real ones.
process.env.DOCA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-backup-home-'));

const test   = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const zip    = require('@zip.js/zip.js');

const H       = require('./helpers');
const store   = require('../modules/store');
const paths   = require('../modules/paths');
const archive = require('../modules/backup/archive');
const restorer = require('../modules/backup/restore');
const secret  = require('../modules/backup/secret');
const { fmSafe } = require('../modules/utils');

test.before(() => H.start());
test.after(() => H.stop());

/** Some state worth backing up. */
function seed(tag) {
  store.writeJson('harness/memory-test', { tag });
  fs.writeFileSync(paths.PREFS_FILE, JSON.stringify({ theme: tag, backup: { encrypt: true } }));
  fs.mkdirSync(path.dirname(paths.CONFIG_PATH), { recursive: true });
  fs.writeFileSync(paths.CONFIG_PATH, JSON.stringify({ key: `sk-${tag}` }));
  fs.mkdirSync(paths.AGENTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(paths.AGENTS_DIR, 'reporter.json'), JSON.stringify({ id: 'reporter', tag }));
}
const state = () => ({
  memory: store.readJson('harness/memory-test', null)?.tag,
  prefs: JSON.parse(fs.readFileSync(paths.PREFS_FILE, 'utf8')).theme,
  keys: JSON.parse(fs.readFileSync(paths.CONFIG_PATH, 'utf8')).key,
  agent: JSON.parse(fs.readFileSync(path.join(paths.AGENTS_DIR, 'reporter.json'), 'utf8')).tag,
});

test('an encrypted backup needs its password, and says when it is wrong', async () => {
  seed('one');
  const b = await archive.create({ password: 'correct horse' });
  assert.equal(b.encrypted, true);
  assert.ok(b.name.endsWith('.dBac'));

  const peek = await archive.peek(b.file);
  assert.equal(peek.encrypted, true);
  await assert.rejects(archive.open(b.file), { code: 'password_required' });
  await assert.rejects(archive.open(b.file, 'wrong'), { code: 'wrong_password' });
  const opened = await archive.open(b.file, 'correct horse');
  assert.equal(opened.manifest.format, 'dBac');
  assert.equal(opened.manifest.dataFormat, store.dataFormat());
  assert.ok(opened.manifest.contents.some(c => c.path === 'keys/openclaw.json'), 'the API keys are in it');
  assert.ok(opened.entries.filter(e => !e.directory).every(e => e.encrypted), 'every entry, not only the manifest');
  await opened.reader.close();
});

test('an open backup is a plain zip that ordinary tools read', async () => {
  const b = await archive.create({ password: null });
  assert.equal(b.encrypted, false);
  const listing = execFileSync('python3', ['-c',
    'import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1]); print(json.loads(z.read("manifest.json"))["format"], len(z.namelist()))', b.file],
  { encoding: 'utf8' });
  assert.match(listing, /^dBac \d+/);
});

test('a restore brings everything back, keeps a safety copy, and leaves nothing behind', async () => {
  seed('before');
  const b = await archive.create({ password: 'pw-restore' });
  seed('after');
  assert.equal(state().memory, 'after');

  const plan = await restorer.plan(b.file, 'pw-restore');
  assert.equal(plan.problem, null);
  assert.deepEqual(plan.sections.map(s => s.name).sort(), ['agents', 'data', 'keys', 'prefs']);

  const r = await restorer.restore(b.file, {
    password: 'pw-restore',
    safety: () => archive.create({ password: 'pw-restore', name: 'safety-before-restore.dBac' }),
  });
  assert.deepEqual(state(), { memory: 'before', prefs: 'before', keys: 'sk-before', agent: 'before' });
  assert.equal(r.safetyBackup, 'safety-before-restore.dBac');

  // The safety copy holds what was replaced.
  const safety = await archive.open(path.join(paths.BACKUP_DIR, r.safetyBackup), 'pw-restore');
  const mem = safety.entries.find(e => e.filename === 'data/harness/memory-test.json');
  assert.match(await mem.getData(new zip.TextWriter(), { password: 'pw-restore' }), /"after"/);
  await safety.reader.close();

  const leftovers = [store.DATA_DIR, paths.AGENTS_DIR, paths.PREFS_FILE].flatMap(p =>
    fs.readdirSync(path.dirname(p)).filter(n => /\.restore-\d+$|\.pre-restore-\d+$/.test(n)));
  assert.deepEqual(leftovers, [], 'no staging or pre-restore copies are left');
});

test('a damaged backup is refused before anything is replaced', async () => {
  seed('good');
  const b = await archive.create({ password: null });
  // Rewrite the archive with one file changed and the old manifest kept.
  const src = new zip.ZipReader(new zip.BlobReader(await fs.openAsBlob(b.file)));
  const out = new zip.ZipWriter(new zip.Uint8ArrayWriter());
  for (const e of await src.getEntries()) {
    let data = await e.getData(new zip.Uint8ArrayWriter());
    if (e.filename === 'data/harness/memory-test.json') data = new TextEncoder().encode('{"tag":"forged"}');
    await out.add(e.filename, new zip.Uint8ArrayReader(data));
  }
  const bad = path.join(paths.BACKUP_DIR, 'damaged.dBac');
  fs.writeFileSync(bad, await out.close());
  await src.close();

  seed('current');
  await assert.rejects(restorer.restore(bad), /does not match its checksum/);
  assert.equal(state().memory, 'current', 'nothing was replaced');
});

test('a backup from a newer data format is refused, and says which version can read it', async () => {
  store.writeJson('format', { dataFormat: 99 });
  const b = await archive.create({ password: null, name: 'future.dBac' });
  store.writeJson('format', { dataFormat: store.DATA_FORMAT });
  const plan = await restorer.plan(b.file);
  assert.match(plan.problem, /data format 99; this version reads up to format 1\. Switch to v\S+ or newer/);
  await assert.rejects(restorer.restore(b.file), /data format 99/);
});

test('the remembered password is its own 0600 file, which the agent\'s file tools refuse', () => {
  secret.save('remember me please');
  assert.equal(fs.statSync(paths.BACKUP_PASSWORD_FILE).mode & 0o777, 0o600);
  assert.equal(secret.settings().hasSavedPassword, true);
  assert.equal(fmSafe(paths.BACKUP_PASSWORD_FILE), false);
  const link = path.join(H.tmp, 'innocent.txt');
  fs.symlinkSync(paths.BACKUP_PASSWORD_FILE, link);
  assert.equal(fmSafe(link), false, 'nor through a symlink');
  assert.throws(() => secret.save('short'), /at least 8/);
  secret.forget();
  assert.equal(secret.settings().hasSavedPassword, false);
});

test('the routes: settings never return the password, and names cannot leave the backup folder', async () => {
  let r = await H.api(null, 'POST', '/api/backups/settings', { encrypt: true, password: 'route password 1' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { encrypt: true, hasSavedPassword: true });

  r = await H.api(null, 'POST', '/api/backups', {});
  assert.equal(r.status, 200, 'the remembered password is used');
  assert.equal(r.body.encrypted, true);

  r = await H.api(null, 'GET', '/api/backups');
  assert.ok(r.body.backups.some(b => b.encrypted), 'listed, and known to be encrypted without the password');
  assert.equal(JSON.stringify(r.body).includes('route password 1'), false);

  await H.api(null, 'POST', '/api/backups/settings', { forget: true });
  r = await H.api(null, 'POST', '/api/backups', {});
  assert.equal(r.status, 400, 'encrypted with no password is an error, never a silent open backup');

  r = await H.api(null, 'GET', `/api/backups/${encodeURIComponent('../.backup-password')}/download`);
  assert.equal(r.status, 400);
  r = await H.api(null, 'DELETE', '/api/backups/nope.dBac');
  assert.equal(r.status, 404);
});

test.after(() => fs.rmSync(process.env.DOCA_HOME, { recursive: true, force: true }));

test('a restore keeps the accounts of an install that has them', async () => {
  const authStore = require('../modules/auth/store');
  const b = await archive.create({ password: null, name: 'before-late-user.dBac' });
  authStore.createUser({ email: 'late@test.local', passwordHash: 'x' });   // made after the backup
  const r = await restorer.restore(b.file, { say: () => {} });
  assert.ok(r.restored.includes('data'));
  assert.ok(authStore.userByEmail('late@test.local'), 'the current accounts were kept, not rolled back');
  assert.ok(authStore.userByEmail('owner@test.local'), 'and nobody was lost');
});

test('an upload larger than the disk can take (or than DOCA_BACKUP_UPLOAD_MAX) is refused, and leaves nothing', async () => {
  process.env.DOCA_BACKUP_UPLOAD_MAX = '1000';
  try {
    const url = `${H.base}/api/backups/upload?name=big.dBac`;
    const headers = { Cookie: H.owner.cookie, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/octet-stream' };
    let r = await fetch(url, { method: 'POST', headers, body: Buffer.alloc(5000) });
    assert.equal(r.status, 413, 'by its declared length');
    assert.match((await r.json()).error, /larger than this machine can take/);
    // No length declared: counted as it arrives.
    const stream = new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(1000)); c.close(); } });
    r = await fetch(url, { method: 'POST', headers, body: stream, duplex: 'half' });
    assert.equal(r.status, 413, 'by what arrived');
    assert.deepEqual(fs.readdirSync(paths.BACKUP_DIR).filter(n => n.startsWith('big.dBac')), [], 'no partial file left');
  } finally { delete process.env.DOCA_BACKUP_UPLOAD_MAX; }
});

test('scheduled backups: due at the set time, never open when no password is saved, and only auto- ones are pruned', async () => {
  const schedule = require('../modules/backup/schedule');
  assert.throws(() => schedule.setConfig({ every: 'hourly' }), /off, daily or weekly/);
  assert.throws(() => schedule.setConfig({ at: '25:00' }), /HH:MM/);
  assert.throws(() => schedule.setConfig({ keep: 0 }), /between 1 and 365/);

  let st = schedule.setConfig({ every: 'daily', at: '03:00', keep: 2 });
  assert.equal(new Date(st.nextAt).getHours(), 3, 'due at 03:00 local');
  assert.ok(Date.parse(st.nextAt) > Date.now() - 1000 && Date.parse(st.nextAt) - Date.now() <= 24 * 3600e3, 'within the next day');

  // A daily one that finished at 03:04 is next due tomorrow at 03:00, not the day after.
  const last = new Date(); last.setHours(3, 4, 0, 0);
  const next = new Date(schedule.nextAt(schedule.config(), { lastAt: last.toISOString() }));
  assert.equal(next.getHours(), 3);
  assert.equal(Math.round((next - last) / 3600e3), 24);

  // Encrypted, no password saved: nothing is made, and it says why.
  secret.setEncrypt(true); secret.forget();
  const before = fs.readdirSync(paths.BACKUP_DIR).filter(n => n.startsWith('auto-')).length;
  let r = await schedule.run();
  assert.match(r.error, /no password is saved/);
  assert.equal(fs.readdirSync(paths.BACKUP_DIR).filter(n => n.startsWith('auto-')).length, before, 'never an open backup instead');
  assert.match(schedule.status().lastError, /no password is saved/);

  secret.save('schedule password');
  const manual = await archive.create({ password: 'schedule password', name: 'by-hand.dBac' });
  for (let i = 0; i < 3; i++) {
    r = await schedule.run({ now: Date.now() + i * 60e3 });
    assert.ok(r.made.startsWith('auto-'), r.error);
    await new Promise(res => setTimeout(res, 20));   // distinct mtimes
  }
  const autos = fs.readdirSync(paths.BACKUP_DIR).filter(n => n.startsWith('auto-'));
  assert.equal(autos.length, 2, 'keeps the last 2');
  assert.ok(fs.existsSync(manual.file), 'a backup made by hand is never pruned');
  assert.equal(schedule.status().lastError, null);
  assert.equal((await archive.peek(path.join(paths.BACKUP_DIR, autos[0]))).encrypted, true);

  const list = await H.api(null, 'GET', '/api/backups');
  assert.equal(list.body.schedule.every, 'daily');
  const set = await H.api(null, 'POST', '/api/backups/schedule', { every: 'off' });
  assert.equal(set.status, 200);
  assert.equal(set.body.nextAt, null);
  secret.forget();
});
