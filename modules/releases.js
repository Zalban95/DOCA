'use strict';

/**
 * Versions side by side, and switching between them — so a broken update is
 * one choice in a dropdown away from the version that worked.
 *
 * Each installed version is a git worktree of this checkout in
 * `.releases/vX.Y.Z`, detached at its tag, with its own node_modules. Which one
 * runs is the one line in `.releases/current`; no file there means the checkout
 * itself runs, exactly as before this existed. `run.sh` reads it on every start
 * and hands every version the same DOCA_HOME, data directory and prefs file, so
 * the code changes and the data does not.
 *
 * A switch writes `.releases/pending` ("to from") before restarting. The
 * launcher starts the new version in the background and waits for it to answer
 * on `/`; if it never does, the launcher switches back on its own. That check
 * lives in run.sh and not here on purpose: the version being switched to is
 * exactly the code that cannot be trusted to judge itself, and an older one does
 * not know this protocol at all.
 *
 * Every switch, confirmation and automatic revert is a line in
 * `.releases/log.jsonl` — that is where "installed here on" comes from; "released
 * on" is the tag's own date.
 */
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const store = require('./store');
const pkg   = require('../package.json');

const CODE_DIR = path.join(__dirname, '..');
const HOME     = process.env.DOCA_HOME || CODE_DIR;
const DIR      = path.join(HOME, '.releases');
const CHECKOUT = 'checkout';

/** The first version with this menu. Older ones can be run, but not switched away from in the UI. */
const MENU_SINCE = '2.54.0';
/** Installed versions kept on disk besides the running one and the one before it. */
const KEEP = 5;
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function git(args, { cwd = HOME, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 16 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => err ? reject(Object.assign(new Error((stderr || err.message).trim()), { stderr })) : resolve(stdout));
  });
}

/* ── State on disk ────────────────────────────────────── */

function read(name) {
  try { return fs.readFileSync(path.join(DIR, name), 'utf8').trim(); } catch { return ''; }
}

/** Write via a temp file and a rename, so the launcher never reads half a line. */
function write(name, text) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = path.join(DIR, `.${name}.tmp`);
  fs.writeFileSync(tmp, `${text}\n`);
  fs.renameSync(tmp, path.join(DIR, name));
}

/** The version the launcher will start: a tag, or CHECKOUT. */
function current() {
  const tag = read('current');
  return tag && fs.existsSync(path.join(DIR, tag, 'server.js')) ? tag : CHECKOUT;
}

/** The version this process is actually running. */
function running() {
  return path.resolve(CODE_DIR) === path.resolve(HOME) ? CHECKOUT : path.basename(CODE_DIR);
}

function log(event) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(path.join(DIR, 'log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

function history() {
  return read('log.jsonl').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/* ── What a tag is ────────────────────────────────────── */

const _facts = new Map();

/**
 * What can be known about a tag without running it, read from the tag itself:
 * whether it reads its data paths from the environment (without that, it would
 * start against an empty data directory of its own), and which data format its
 * code writes.
 */
async function factsOf(tag) {
  if (_facts.has(tag)) return _facts.get(tag);
  const show = f => git(['show', `${tag}:${f}`], { timeout: 10000 }).catch(() => '');
  const [storeJs, pathsJs, pkgJson] = await Promise.all([show('modules/store.js'), show('modules/paths.js'), show('package.json')]);
  let dataFormat = 1;
  try { dataFormat = Number(JSON.parse(pkgJson).docaDataFormat) || 1; } catch {}
  const facts = {
    compatible: storeJs.includes('DOCA_DATA_DIR') && pathsJs.includes('DOCA_PREFS_FILE'),
    dataFormat,
  };
  _facts.set(tag, facts);
  return facts;
}

let _fetchedAt = 0;

/** Fetch the tags at most every five minutes; a list without the network is still a list. */
async function fetchTags() {
  if (Date.now() - _fetchedAt < 5 * 60 * 1000) return null;
  try { await git(['fetch', '--tags', '--quiet', 'origin'], { timeout: 20000 }); _fetchedAt = Date.now(); return null; }
  catch (e) { return `Could not fetch new versions (${e.message.split('\n')[0]}); showing the ones already known here.`; }
}

/**
 * Everything the dropdown shows, newest first, the checkout last.
 * @returns {Promise<{ running: string, current: string, dataFormat: number, launcher: boolean,
 *                     warning: string|null, versions: object[] }>}
 */
/** Whether this install can have versions at all: they are git worktrees of a checkout. */
function isCheckout() {
  return fs.existsSync(path.join(HOME, '.git'));
}

async function list() {
  // An install that did not come from `git clone` (a download, a copy) has no
  // tags to list; say so instead of answering 500 "not a git repository".
  if (!isCheckout()) {
    return { running: running(), current: current(), version: pkg.version, dataFormat: store.dataFormat(),
      launcher: !!process.env.DOCA_HOME, versions: [],
      warning: 'This install is not a git checkout, so there are no other versions to switch to. Install DOCA with git clone to use this.' };
  }
  const warning = await fetchTags();
  const out = await git(['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%09%(creatordate:iso-strict)', 'refs/tags']);
  const rows = out.split('\n').map(l => l.split('\t')).filter(([t]) => TAG.test(t));
  rows.sort((a, b) => cmpVersion(b[0], a[0]));

  const hist = history();
  const installedAt = tag => [...hist].reverse().find(e => e.to === tag && (e.event === 'switch' || e.event === 'confirm'))?.at || null;
  const cur = current(), run = running(), dataFormat = store.dataFormat();

  const versions = [];
  for (const [tag, releasedAt] of rows.slice(0, 40)) {
    const facts = await factsOf(tag);
    versions.push({
      tag, releasedAt, installedAt: installedAt(tag),
      installed: fs.existsSync(path.join(DIR, tag, 'server.js')),
      current: tag === cur, running: tag === run,
      compatible: facts.compatible,
      dataFormat: facts.dataFormat,
      olderData: facts.dataFormat < dataFormat,
      hasMenu: cmpVersion(tag, MENU_SINCE) >= 0,
    });
  }
  let head = '';
  try { head = (await git(['log', '-1', '--format=%h %cI %D'])).trim(); } catch {}
  const co = checkoutFormat();
  versions.push({ tag: CHECKOUT, head, installedAt: installedAt(CHECKOUT), installed: true,
    current: cur === CHECKOUT, running: run === CHECKOUT, compatible: true, dataFormat: co,
    olderData: co < dataFormat, hasMenu: true });

  return { running: run, current: cur, version: pkg.version, dataFormat, launcher: !!process.env.DOCA_HOME, warning, versions };
}

/** The data format the checkout's code writes — it can be older than the data too, after a pull of an old branch. */
function checkoutFormat() {
  try { return Number(JSON.parse(fs.readFileSync(path.join(HOME, 'package.json'), 'utf8')).docaDataFormat) || 1; }
  catch { return 1; }
}

/* ── Installing and switching ─────────────────────────── */

/**
 * What a version's dependencies are, as a hash — without its own version number.
 * package-lock.json repeats the app's version at the top and on the root
 * package, so hashing the file whole made every release look different from
 * every other and hard-linking never happened.
 */
const lockHash = dir => {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
    delete lock.version;
    if (lock.packages?.['']) delete lock.packages[''].version;
    return crypto.createHash('sha1').update(JSON.stringify(lock)).digest('hex');
  } catch { return null; }
};

function run(cmd, args, cwd, say) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    child.stdout.on('data', d => say(String(d)));
    child.stderr.on('data', d => say(String(d)));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`)));
  });
}

/**
 * Put a version on disk: a worktree at its tag, then its dependencies. When its
 * package-lock matches one already installed, node_modules is hard-linked from
 * there — the same bytes, no download, a second instead of a minute.
 */
async function install(tag, say = () => {}) {
  const dest = path.join(DIR, tag);
  if (fs.existsSync(path.join(dest, 'server.js')) && fs.existsSync(path.join(dest, 'node_modules'))) {
    say(`${tag} is already installed.\n`);
    return dest;
  }
  fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(path.join(dest, 'server.js'))) {
    say(`$ git worktree add --detach .releases/${tag} ${tag}\n`);
    try { await git(['worktree', 'prune']); } catch {}
    await run('git', ['worktree', 'add', '--detach', '--force', dest, tag], HOME, say);
  }
  const want = lockHash(dest);
  const donor = [HOME, ...fs.readdirSync(DIR).map(d => path.join(DIR, d))]
    .find(d => d !== dest && want && lockHash(d) === want && fs.existsSync(path.join(d, 'node_modules')));
  if (donor) {
    say(`Dependencies are identical to ${path.relative(HOME, donor) || 'the checkout'}'s — linking them.\n`);
    try { await run('cp', ['-al', path.join(donor, 'node_modules'), path.join(dest, 'node_modules')], dest, say); return dest; }
    catch (e) { say(`Linking failed (${e.message}); installing instead.\n`); }
  }
  say('$ npm ci --omit=dev\n');
  await run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], dest, say);
  return dest;
}

/** Why a switch to `target` must not happen, or null. */
async function refusal(target, { force = false } = {}) {
  if (!process.env.DOCA_HOME)
    return 'This panel was not started by run.sh (or the boot service), so nothing would read the choice. Start it with ./run.sh and try again.';
  if (target === CHECKOUT) {
    return checkoutFormat() < store.dataFormat() && !force
      ? `The working copy writes data format ${checkoutFormat()}, and your data is already format ${store.dataFormat()}. Update the checkout first, or switch with force if you accept the risk.`
      : null;
  }
  if (!TAG.test(target)) return `"${target}" is not a version tag.`;
  try { await git(['rev-parse', '--verify', '--quiet', `refs/tags/${target}`]); }
  catch { return `There is no ${target} here. Check the name, or let the list fetch new versions first.`; }
  const facts = await factsOf(target);
  if (!facts.compatible)
    return `${target} is older than the data paths every version shares — it would start with none of your conversations, devices or settings.`;
  if (facts.dataFormat < store.dataFormat() && !force)
    return `${target} writes data format ${facts.dataFormat}, and your data is already format ${store.dataFormat()}. `
      + 'Running it could damage the data. Restore a backup made on that version instead, or switch with force if you accept the risk.';
  return null;
}

/**
 * Switch the version the launcher starts, and restart into it.
 * @param {string} target  a tag like v2.53.0, or 'checkout'
 * @param {{ force?: boolean, by?: string, say?: (s: string) => void, restart?: boolean }} opts
 */
async function use(target, { force = false, by = 'ui', say = () => {}, restart = true } = {}) {
  const why = await refusal(target, { force });
  if (why) throw Object.assign(new Error(why), { status: 409 });
  const from = current();
  if (target === from) { say(`${target} is already the version in use.\n`); return { from, to: target, restarting: false }; }

  if (target !== CHECKOUT) await install(target, say);

  write('pending', `${target} ${from}`);
  if (target === CHECKOUT) fs.rmSync(path.join(DIR, 'current'), { force: true });
  else write('current', target);
  log({ event: 'switch', to: target, from, by, force: force || undefined });
  say(`\nSwitched: ${from} → ${target}. If it does not answer within 90 s, the launcher switches back to ${from} on its own.\n`);

  prune(target, from, say);
  if (restart) setTimeout(restartSelf, 300);
  return { from, to: target, restarting: restart };
}

/** Exit into the launcher: the supervisor starts run.sh again, or a detached run.sh takes over. */
function restartSelf() {
  const { supervisorName } = require('./update');
  if (!supervisorName()) {
    const out = fs.openSync(path.join(DIR, 'restart.log'), 'a');
    spawn('bash', [path.join(HOME, 'run.sh'), 'start'], { cwd: HOME, detached: true, stdio: ['ignore', out, out], env: process.env }).unref();
  }
  process.exit(0);
}

/** Keep the newest KEEP installed versions, plus the ones switched between. */
function prune(keepA, keepB, say = () => {}) {
  let dirs = [];
  try { dirs = fs.readdirSync(DIR).filter(d => TAG.test(d) && fs.existsSync(path.join(DIR, d, 'server.js'))); } catch { return; }
  const drop = dirs.sort((a, b) => cmpVersion(b, a)).filter(d => d !== keepA && d !== keepB && d !== running()).slice(KEEP);
  for (const d of drop) {
    git(['worktree', 'remove', '--force', path.join(DIR, d)])
      .then(() => say(`Removed ${d} (keeping ${KEEP} installed versions).\n`))
      .catch(() => {});
  }
}

/* ── Routes ───────────────────────────────────────────── */

async function handleList(_req, res) {
  try { res.json(await list()); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/versions/use { version, force } — streamed, then the panel restarts. */
async function handleUse(req, res) {
  const { sseHeaders } = require('./utils');
  sseHeaders(res);
  const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };
  const say = status => send({ status });
  try {
    // { whenIdle: true }: switch now, restart into it once running turns end (harness/drain.js).
    const drain = require('./harness/drain');
    const wait = req.body?.whenIdle === true && drain.busy().length > 0;
    const r = await use(String(req.body?.version || ''), { force: req.body?.force === true, by: 'ui', say, restart: !wait });
    if (wait && r.from !== r.to) {
      const waiting = drain.whenIdle(() => restartSelf(), { label: `switch to ${r.to}` });
      say(`Waiting for ${waiting.waitingOn.length} running turn(s) to finish before restarting into ${r.to}.\n`);
      send({ done: true, ok: true, ...r, restarting: false, waiting });
      return res.end();
    }
    send({ done: true, ok: true, ...r });
  } catch (e) {
    send({ done: true, ok: false, status: `\n✗ ${e.message}\n` });
  }
  res.end();
}

function mount(app) {
  app.get ('/api/versions',     handleList);
  app.post('/api/versions/use', handleUse);
}

/** The newest version tag here, after fetching. */
async function latest() {
  await fetchTags();
  const out = await git(['tag', '--list', 'v*']);
  return out.split('\n').filter(t => TAG.test(t)).sort((a, b) => cmpVersion(b, a))[0] || null;
}

module.exports = { isCheckout, restartSelf, latest, list, install, use, refusal, current, running, history, prune, mount, cmpVersion, CHECKOUT, DIR, HOME, MENU_SINCE };
