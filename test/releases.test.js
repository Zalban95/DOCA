'use strict';

/**
 * Rolling back and forward: versions as worktrees of a checkout, the choice in
 * .releases/current, and the launcher (the real run.sh) switching back on its
 * own when a new version does not answer.
 *
 * Everything runs against a throwaway git repository standing in for the
 * checkout, so DOCA_HOME is set before the module is loaded.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const net    = require('node:net');
const { execFileSync, spawn } = require('node:child_process');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-releases-'));
process.env.DOCA_HOME = HOME;
process.env.DOCA_DATA_DIR = path.join(HOME, '.doca');
process.env.DOCA_PREFS_FILE = path.join(HOME, '.dashboard-prefs.json');

const git = (...a) => execFileSync('git', ['-C', HOME, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' });

/** Commit a version of the fake panel and tag it. */
function release(tag, { compatible = true, dataFormat = 2, server = 'answer' } = {}) {
  const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(HOME, f)), { recursive: true }); fs.writeFileSync(path.join(HOME, f), t); };
  w('modules/store.js', compatible ? 'process.env.DOCA_DATA_DIR' : 'nothing');
  w('modules/paths.js', compatible ? 'process.env.DOCA_PREFS_FILE' : 'nothing');
  w('package.json', JSON.stringify({ name: 'fake', version: tag.slice(1), docaDataFormat: dataFormat }));
  // Real lockfiles repeat the app's own version; identical dependencies must still match.
  w('package-lock.json', JSON.stringify({ name: 'fake', version: tag.slice(1), lockfileVersion: 3,
    packages: { '': { name: 'fake', version: tag.slice(1) }, 'node_modules/dep': { version: '1.0.0' } } }));
  w('server.js', server === 'answer'
    ? `require('http').createServer((q, r) => r.end('${tag}')).listen(process.env.PORT, '127.0.0.1');`
    : 'process.exit(1);');
  git('add', '-A'); git('commit', '-qm', tag); git('tag', tag);
}

execFileSync('git', ['init', '-q', '-b', 'main', HOME]);
fs.copyFileSync(path.join(__dirname, '..', 'run.sh'), path.join(HOME, 'run.sh'));
fs.writeFileSync(path.join(HOME, '.gitignore'), '/.releases/\n/node_modules/\n/.doca/\n/run.sh\n');
release('v0.9.0', { compatible: false });
release('v1.0.0');
release('v1.1.0', { server: 'crash' });
release('v1.2.0', { dataFormat: 1 });            // older than the data (format 2)
release('v2.0.0');                                   // the checkout stays here: it answers
fs.mkdirSync(path.join(HOME, 'node_modules', 'dep'), { recursive: true });
fs.writeFileSync(path.join(HOME, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;');

// The data here is format 2; v1.2.0's code writes format 1.
fs.mkdirSync(process.env.DOCA_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.DOCA_DATA_DIR, 'format.json'), JSON.stringify({ dataFormat: 2 }));

const releases = require('../modules/releases');

test('the list is newest first, with release dates, and the checkout last', async () => {
  const l = await releases.list();
  assert.deepEqual(l.versions.map(v => v.tag), ['v2.0.0', 'v1.2.0', 'v1.1.0', 'v1.0.0', 'v0.9.0', 'checkout']);
  assert.equal(l.current, 'checkout');
  assert.ok(l.versions[0].releasedAt, 'a release date from the tag');
  assert.equal(l.versions.find(v => v.tag === 'v0.9.0').compatible, false, 'too old to find the shared data');
  assert.equal(l.versions.find(v => v.tag === 'v1.2.0').olderData, true);
  assert.equal(l.launcher, true);
});

test('a switch is refused for a version that would not find the data, an unknown one, or older data', async () => {
  assert.match(await releases.refusal('v0.9.0'), /would start with none of your conversations/);
  assert.match(await releases.refusal('v9.9.9'), /There is no v9\.9\.9/);
  assert.match(await releases.refusal('v1.2.0'), /writes data format 1, and your data is already format 2/);
  assert.equal(await releases.refusal('v1.2.0', { force: true }), null, 'unless forced');
  assert.equal(await releases.refusal('v1.0.0'), null);
});

test('switching installs the version as a worktree, links identical dependencies, and records it', async () => {
  const said = [];
  const r = await releases.use('v1.0.0', { restart: false, say: s => said.push(s) });
  assert.deepEqual(r, { from: 'checkout', to: 'v1.0.0', restarting: false });

  const dir = path.join(HOME, '.releases', 'v1.0.0');
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8').includes('"1.0.0"'), true, 'the tag\'s own code');
  const a = fs.statSync(path.join(HOME, 'node_modules', 'dep', 'index.js')).ino;
  const b = fs.statSync(path.join(dir, 'node_modules', 'dep', 'index.js')).ino;
  assert.equal(a, b, 'node_modules is hard-linked, not downloaded again');
  assert.match(said.join(''), /identical to the checkout's — linking/);

  assert.equal(fs.readFileSync(path.join(HOME, '.releases', 'current'), 'utf8').trim(), 'v1.0.0');
  assert.equal(fs.readFileSync(path.join(HOME, '.releases', 'pending'), 'utf8').trim(), 'v1.0.0 checkout');
  assert.equal(git('status', '--porcelain').trim(), '', 'the checkout stays clean');

  const l = await releases.list();
  assert.ok(l.versions.find(v => v.tag === 'v1.0.0').installedAt, 'installed here, with a date');
  assert.equal(releases.history().at(-1).event, 'switch');
});

/** A free TCP port. */
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

/** Start the real launcher, wait until `until()` holds, then stop it. */
async function launch(until, ms = 30000) {
  const port = await freePort();
  const child = spawn('bash', [path.join(HOME, 'run.sh'), 'start'], {
    cwd: HOME, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < ms) {
      if (until()) return out;
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error(`timed out; launcher said:\n${out}`);
  } finally {
    // The launcher alone, as a stop reaches it; it must pass the stop on.
    child.kill('SIGTERM');
    const gone = await new Promise(r => { child.on('exit', () => r(true)); setTimeout(() => r(child.exitCode !== null), 5000); });
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    assert.ok(gone, 'the launcher exited on SIGTERM');
  }
}

const events = () => releases.history().map(e => `${e.event}:${e.to}`);

test('the launcher keeps a version that answers, and confirms it', async () => {
  fs.writeFileSync(path.join(HOME, '.releases', 'pending'), 'v1.0.0 checkout\n');
  const out = await launch(() => events().includes('confirm:v1.0.0'));
  assert.match(out, /v1\.0\.0 answers — keeping it/);
  assert.equal(fs.existsSync(path.join(HOME, '.releases', 'pending')), false);
  assert.equal(fs.readFileSync(path.join(HOME, '.releases', 'current'), 'utf8').trim(), 'v1.0.0');
});

test('the launcher switches back on its own when a new version does not answer', async () => {
  const r = await releases.use('v1.1.0', { restart: false });
  assert.equal(r.from, 'v1.0.0');
  const out = await launch(() => events().includes('revert:v1.0.0'));
  assert.match(out, /v1\.1\.0 did not answer within 90 s — switched back to v1\.0\.0/);
  assert.equal(fs.readFileSync(path.join(HOME, '.releases', 'current'), 'utf8').trim(), 'v1.0.0', 'back on the one that worked');
  assert.equal(fs.existsSync(path.join(HOME, '.releases', 'pending')), false);
});

test('a second release links its dependencies from the first, although its lockfile names another version', async () => {
  const said = [];
  await releases.install('v2.0.0', s => said.push(s));
  assert.match(said.join(''), /identical to (the checkout|\.releases\/v1\.[01]\.0)'s — linking/);
  assert.equal(said.join('').includes('npm ci'), false, 'nothing downloaded');
});

test('the newest version is the highest tag, not the latest made', async () => {
  assert.equal(await releases.latest(), 'v2.0.0');
});

test('back to the checkout removes the choice, and the checkout runs as before', async () => {
  await releases.use('checkout', { restart: false });
  assert.equal(fs.existsSync(path.join(HOME, '.releases', 'current')), false);
  assert.equal(releases.current(), 'checkout');
  fs.rmSync(path.join(HOME, '.releases', 'pending'), { force: true });
});

test.after(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});
