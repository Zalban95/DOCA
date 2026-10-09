'use strict';

/**
 * Updates carried on a file (modules/update-channel/update-file.js, from-file.js, deploy/hive.sh update --file): a tar
 * any host's `tar` reads, opened only when its manifest is signed by a release key this build trusts and its zip
 * matches the signed sha256; installed by a host who typed their password, staged beside the running version and
 * switched to once nothing runs; an older version only when the person says to go back. The test release key is
 * trusted by test/update-trust.js alone.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder, and trusts the test keys
const U = require('./update-trust');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const uf = () => require('../modules/update-channel/update-file');
const ch = () => require('../modules/update-channel');
const releases = () => require('../modules/releases');
const ROOT = path.join(__dirname, '..');
const RUNNING = require('../package.json').version;
const dir = fs.mkdtempSync(path.join(H.tmp || require('os').tmpdir(), 'update-file-'));
let restarts = 0;

const post = (file, { older = false, headers = {} } = {}) => fetch(`${H.base}/api/update/file${older ? '?older=1' : ''}`, { method: 'POST',
  body: fs.readFileSync(file), headers: { 'Content-Type': 'application/octet-stream', 'Sec-Fetch-Site': 'same-origin', Cookie: H.owner.cookie, 'X-Doca-Password': H.owner.password, ...headers } })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

test.before(async () => {
  await H.start();
  ch().hooks.restart = () => { restarts++; };
  ch().hooks.deps = async d => { fs.mkdirSync(path.join(d, 'node_modules'), { recursive: true }); fs.writeFileSync(path.join(d, 'node_modules', '.package-lock.json'), '{}'); };
});
test.after(async () => { await H.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('the file is a tar any tar reads; it opens only signed by a release key, its zip as signed', { skip: !spawnSync('tar', ['--version']).stdout?.length && 'no tar here' }, () => {
  const f = U.file(path.join(dir, 'a.dupd'), '99.0.0', { image: Buffer.from('an image tarball') });
  assert.deepEqual(spawnSync('tar', ['-tf', f], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/), ['doca-update.json', 'doca-99.0.0.zip', 'image.tar']);
  const o = uf().open(f);
  assert.equal(o.manifest.version, '99.0.0');
  assert.equal(o.keyId, 'test-release');
  assert.ok(o.image && o.image.size === 16);
  assert.throws(() => uf().open(U.file(path.join(dir, 'b.dupd'), '99.0.0', { key: U.other() })), /not signed by the project's release key/);
  assert.throws(() => uf().open(U.file(path.join(dir, 'c.dupd'), '99.0.0', { tamper: true })), /does not match the sha256/);
  fs.writeFileSync(path.join(dir, 'd.dupd'), 'not a tar at all');
  assert.throws(() => uf().open(path.join(dir, 'd.dupd')), /not a DOCA update file/);
  // Cut short: the zip's bytes are not all there.
  const whole = fs.readFileSync(f);
  fs.writeFileSync(path.join(dir, 'e.dupd'), whole.subarray(0, 1500));
  assert.throws(() => uf().open(path.join(dir, 'e.dupd')), /cut short|does not carry|sha256/);
});

test('installing is a host\'s, with the password; an unsigned file is refused before anything is staged', async () => {
  const f = U.file(path.join(dir, 'unsigned.dupd'), '99.1.0', { key: U.other() });
  const asked = await post(f, { headers: { 'X-Doca-Password': '' } });
  assert.equal(asked.status, 401, JSON.stringify(asked.body));
  assert.equal(asked.body.code, 'password_required');
  const member = await H.signIn('member', 'member-file@test.local');
  const m = await post(f, { headers: { Cookie: member.cookie, 'X-Doca-Password': member.password } });
  assert.equal(m.status, 403);
  const r = await post(f);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not signed/);
  assert.equal(fs.existsSync(path.join(releases().DIR, 'v99.1.0')), false, 'nothing staged');
  assert.deepEqual(fs.readdirSync(require('../modules/update-channel/from-file').uploads()), [], 'the upload is not kept');
});

test('a signed file: staged while a turn runs, switched once it ends, through the launcher\'s way back', async () => {
  const f = U.file(path.join(dir, 'good.dupd'), '99.0.0');
  const lifecycle = require('../modules/harness/turn/lifecycle');
  lifecycle.running.set('busy-turn', { auto: false });
  try {
    const r = await post(f);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.file.tag, 'v99.0.0');
    const staged = path.join(releases().DIR, 'v99.0.0');
    assert.equal(require('../modules/update-channel/stage').verified(staged)?.from, 'file');
    await new Promise(x => setTimeout(x, 2300));
    assert.ok((await H.api(null, 'GET', '/api/update/file')).body.waiting, 'waits for the running turn');
    assert.equal(releases().current(), 'checkout', 'nothing switched while the turn runs');
  } finally { lifecycle.running.delete('busy-turn'); }
  for (let i = 0; i < 60 && releases().current() !== 'v99.0.0'; i++) await new Promise(x => setTimeout(x, 100));
  assert.equal(releases().current(), 'v99.0.0', 'switched once nothing ran');
  assert.match(fs.readFileSync(path.join(releases().DIR, 'pending'), 'utf8'), /v99\.0\.0 checkout/, 'the launcher watches it for 90 s');
  await new Promise(x => setTimeout(x, 400));
  assert.equal(restarts, 1, 'and restarts into it');
  // In development the version list shows it beside the tags, and a switch back to it needs no tag.
  assert.equal(await releases().refusal('v99.0.0'), null);
  // After the restart the old version still runs: the launcher put it back, so it is said and not tried by itself.
  fs.rmSync(path.join(releases().DIR, 'pending'), { force: true }); fs.rmSync(path.join(releases().DIR, 'current'), { force: true });
  assert.deepEqual(ch().outcome(), { ok: false, version: '99.0.0' });
  assert.equal((await H.api(null, 'GET', '/api/update/file')).body.failed.version, '99.0.0');
});

test('an older version only when going back; the version running is refused; a call-off leaves it staged', async () => {
  const [a, b, c] = RUNNING.split('.').map(Number);
  const older = c > 0 ? `${a}.${b}.${c - 1}` : b > 0 ? `${a}.${b - 1}.0` : `${a - 1}.0.0`;
  const f = U.file(path.join(dir, 'older.dupd'), older);
  const no = await post(f);
  assert.equal(no.status, 409);
  assert.match(no.body.error, /older than .* tick "Go back to this version"/);
  const same = await post(U.file(path.join(dir, 'same.dupd'), RUNNING));
  assert.equal(same.status, 409);
  assert.match(same.body.error, /running now/);
  const lifecycle = require('../modules/harness/turn/lifecycle');
  lifecycle.running.set('busy-2', { auto: false });
  try {
    const yes = await post(f, { older: true });
    assert.equal(yes.status, 200, JSON.stringify(yes.body));
    assert.equal(yes.body.file.older, true);
    const off = await H.api(null, 'POST', '/api/update/file/cancel', {});
    assert.equal(off.body.cancelled, true);
    assert.equal(require('../modules/harness/drain').pending(), null, 'nothing waits');
    assert.ok(fs.existsSync(path.join(releases().DIR, `v${older}`, 'server.js')), 'it stays staged');
  } finally { lifecycle.running.delete('busy-2'); }
});

test('bin/doca-update.js verify: the hive\'s own keys decide, from the manifest alone', () => {
  const run = f => spawnSync(process.execPath, ['-r', path.join(__dirname, 'update-trust.js'), path.join(ROOT, 'bin', 'doca-update.js'), 'verify'],
    { input: uf().readEntry(f, uf().entries(f).get('doca-update.json')), encoding: 'utf8', env: { ...process.env } });
  const ok = run(U.file(path.join(dir, 'v.dupd'), '99.2.0', { image: Buffer.from('img') }));
  assert.equal(ok.status, 0, ok.stderr);
  const j = JSON.parse(ok.stdout);
  assert.equal(j.version, '99.2.0'); assert.equal(j.newer, true); assert.equal(j.image, 'doca-hive:99.2.0'); assert.match(j.imageSha256, /^[0-9a-f]{64}$/);
  const bad = run(U.file(path.join(dir, 'w.dupd'), '99.2.0', { key: U.other() }));
  assert.equal(bad.status, 1); assert.match(bad.stderr, /not signed/);
});

test('hive.sh update --file: checked by the hive, its image matched to the signed sha256 before docker loads it', { skip: process.platform === 'win32' && 'bash is not the shell here' }, () => {
  const bin = path.join(dir, 'fake-docker');
  const log = path.join(dir, 'docker.log');
  // A Docker that knows one hive, answers verify with this checkout's code and the test key, and records the rest.
  fs.writeFileSync(bin, `#!/usr/bin/env bash
echo "$*" >> "${log}"
case "$1" in
  inspect) case "$*" in *doca.hive\\"*) echo hive-x ;; *State.Running*) echo true ;; *Config.Image*) echo doca-hive:old ;; esac ;;
  exec) shift; [ "$1" = -i ] && shift; shift; DOCA_DATA_DIR="${dir}/data" exec "${process.execPath}" -r "${path.join(__dirname, 'update-trust.js')}" "${ROOT}/$2" "\${@:3}" ;;
  load) cp "$3" "${dir}/loaded.tar" ;;
  image) [ -f "${dir}/loaded.tar" ] ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
  const sh = args => spawnSync('bash', [path.join(ROOT, 'deploy', 'hive.sh'), 'update', 'hive-x', ...args], { encoding: 'utf8', env: { ...process.env, DOCKER: bin } });
  const unsigned = sh(['--file', U.file(path.join(dir, 'h1.dupd'), '99.3.0', { key: U.other(), image: Buffer.from('img') })]);
  assert.equal(unsigned.status, 1); assert.match(unsigned.stderr, /does not trust .*not signed/);
  const noImage = sh(['--file', U.file(path.join(dir, 'h2.dupd'), '99.3.0')]);
  assert.equal(noImage.status, 1); assert.match(noImage.stderr, /carries no image/);
  const older = sh(['--file', U.file(path.join(dir, 'h3.dupd'), '0.0.1', { image: Buffer.from('img') })]);
  assert.equal(older.status, 1); assert.match(older.stderr, /pass --go-back/);
  // The image's bytes changed after signing: the signed sha256 says no, and docker never loads it.
  const good = U.file(path.join(dir, 'h4.dupd'), '99.3.0', { image: Buffer.from('the real image') });
  const bytes = fs.readFileSync(good), at = bytes.indexOf('the real image');
  const bad = Buffer.from(bytes); bad.write('the fake image', at);
  fs.writeFileSync(path.join(dir, 'h5.dupd'), bad);
  const tampered = sh(['--file', path.join(dir, 'h5.dupd')]);
  assert.equal(tampered.status, 1); assert.match(tampered.stderr, /does not match the sha256/);
  assert.equal(fs.existsSync(path.join(dir, 'loaded.tar')), false);
  // A good one is loaded, and the update goes on as with --image (here the hold ends it: the fake hive says nothing).
  const r = sh(['--file', good, '--timeout', '1']);
  assert.equal(fs.readFileSync(path.join(dir, 'loaded.tar'), 'utf8'), 'the real image');
  assert.match(r.stdout, /updating hive-x: doca-hive:old → doca-hive:99\.3\.0/, r.stdout + r.stderr);
});
