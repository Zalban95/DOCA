'use strict';

/**
 * A downloaded release, put beside the others as a version the launcher can start (releases.js): `.releases/vX.Y.Z`,
 * the zip's files and their dependencies, and `.doca-release.json` — its signed manifest, so a production hive can
 * check it again before every switch. A version is staged while work runs (it disturbs nothing); switching to it is
 * what waits (index.js).
 *
 *   stage(release, zip)   unpack, check, install dependencies (linked from a version with the same lock when there is
 *                         one, else npm ci), mark; resolves to the version's tag
 *   installed()           the signed versions here, newest first
 *   refusal(target)       why a production hive must not switch to `target` (only a signed version here, or the
 *                         checkout it was installed as), or null
 *   list()                what Settings → General → Updates shows in production: the same shape as releases.list()
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const manifest = require('./manifest');

const MARK = '.doca-release.json';
const TAG = /^v(\d+\.\d+\.\d+)$/;
const releases = () => require('../releases');

const lockHash = dir => {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
    delete lock.version;
    if (lock.packages?.['']) delete lock.packages[''].version;
    return crypto.createHash('sha1').update(JSON.stringify(lock)).digest('hex');
  } catch { return null; }
};
const hasDeps = d => fs.existsSync(path.join(d, 'node_modules', '.package-lock.json'));

function markOf(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, MARK), 'utf8')); } catch { return null; } }

/** The mark is checked again, against the release keys in this build, whenever it is read for a decision. */
function verified(dir) {
  const m = markOf(dir);
  if (!m) return null;
  try { require('./manifest').verify(m.manifest, m.signature, require('./keys').RELEASE_KEYS); return m; } catch { return null; }
}

function npmCi(dir, say) {
  return new Promise((resolve, reject) => {
    const spec = require('../mcp/spawn-spec').spawnSpec('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund']);
    const child = spawn(spec.file, spec.args, { cwd: dir, windowsHide: true, ...spec.opts });
    child.stdout.on('data', d => say(String(d)));
    child.stderr.on('data', d => say(String(d)));
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`npm ci exited with ${code}`))));
  });
}

async function stage(r, zipFile, { say = () => {}, deps = npmCi } = {}) {
  const tag = `v${r.manifest.version}`;
  const dir = releases().DIR;
  const dest = path.join(dir, tag);
  const have = verified(dest);
  if (have && have.manifest.sha256 === r.manifest.sha256 && hasDeps(dest)) { say(`${tag} is already staged.\n`); return tag; }
  if (releases().running() === tag) throw new Error(`${tag} is the version running now.`);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${tag}.staging-${process.pid}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    say(`Unpacking ${path.basename(zipFile)}\n`);
    for (const e of require('../packs/zip').read(fs.readFileSync(zipFile))) {
      const to = path.join(tmp, e.name);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, e.data);
    }
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8')); } catch { /* checked below */ }
    if (pkg.version !== r.manifest.version || !fs.existsSync(path.join(tmp, 'server.js')))
      throw new Error(`The release's files are not DOCA ${r.manifest.version} (its package.json says ${pkg.version || 'nothing'}).`);
    const want = lockHash(tmp);
    const donor = [releases().HOME, path.join(__dirname, '..', '..'), ...fs.readdirSync(dir).map(d => path.join(dir, d))]
      .find(d => !d.includes('.staging-') && want && lockHash(d) === want && hasDeps(d));
    if (donor) { say(`Dependencies as in ${path.basename(donor)}: linked.\n`); require('../link-tree').linkTree(path.join(donor, 'node_modules'), path.join(tmp, 'node_modules')); }
    else { say('$ npm ci --omit=dev\n'); await deps(tmp, say); }
    fs.writeFileSync(path.join(tmp, MARK), JSON.stringify({ manifest: r.manifest, signature: r.signature, keyId: r.keyId, from: 'channel', at: new Date().toISOString() }, null, 2));
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    say(`${tag} is staged.\n`);
    return tag;
  } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
}

function installed() {
  let names = [];
  try { names = fs.readdirSync(releases().DIR).filter(n => TAG.test(n)); } catch { return []; }
  return names.map(n => ({ tag: n, mark: verified(path.join(releases().DIR, n)) })).filter(x => x.mark)
    .sort((a, b) => manifest.cmp(b.tag.slice(1), a.tag.slice(1)));
}

function refusal(target) {
  if (target === releases().CHECKOUT) return null;   // the code this hive was installed as: never changed from inside
  if (!TAG.test(String(target))) return `"${target}" is not a version.`;
  const m = verified(path.join(releases().DIR, target));
  if (!m) return `${target} is not a signed release on this hive: a production hive runs only what the update channel installed and verified (Settings → General → Updates).`;
  if (Number(m.manifest.dataFormat || 1) < require('../store').dataFormat()) return `${target} writes an older data format than this hive's data.`;
  return null;
}

function list() {
  const r = releases(), store = require('../store');
  const cur = r.current(), run = r.running(), dataFormat = store.dataFormat();
  const hist = r.history();
  const installedAt = tag => [...hist].reverse().find(e => e.to === tag && (e.event === 'switch' || e.event === 'confirm'))?.at || null;
  const versions = installed().map(({ tag, mark }) => ({ tag, releasedAt: mark.at, installedAt: installedAt(tag), installed: true,
    current: tag === cur, running: tag === run, compatible: true, dataFormat: Number(mark.manifest.dataFormat || 1),
    olderData: Number(mark.manifest.dataFormat || 1) < dataFormat, hasMenu: true, signed: mark.keyId }));
  let co = '';
  try { co = JSON.parse(fs.readFileSync(path.join(r.HOME, 'package.json'), 'utf8')).version; } catch { /* unreadable */ }
  versions.push({ tag: r.CHECKOUT, head: `as installed${co ? ` (${co})` : ''}`, installedAt: installedAt(r.CHECKOUT), installed: true,
    current: cur === r.CHECKOUT, running: run === r.CHECKOUT, compatible: true, dataFormat, olderData: false, hasMenu: true });
  return { running: run, current: cur, version: require('../../package.json').version, dataFormat, launcher: !!process.env.DOCA_HOME,
    platform: process.platform, warning: null, production: true, versions };
}

module.exports = { stage, installed, refusal, list, verified, MARK };
