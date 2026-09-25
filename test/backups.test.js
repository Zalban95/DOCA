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
