'use strict';

/**
 * Installing an update from a file (update-file.js) — Settings → General → Updates → "Install from a file", for a hive
 * that cannot reach the update channel, in production and development alike:
 *
 *   install(file, {older})   open it (signed by a release key this build trusts, its zip's sha256 as signed), refuse a
 *                            version that runs already, one older than what runs unless the person said to go back,
 *                            and one writing an older data format than the data; stage it beside the running version
 *                            (stage.js) and switch to it **once nothing runs**, as a channel update: through
 *                            releases.use, so the launcher puts the old version back if the new one does not answer
 *                            in 90 s; the outcome after the restart is index.js outcome()'s, and a version that did
 *                            not start is not tried again by itself (a file is installed once, by a person)
 *   resume()                 after a restart while it waited: wait again (the wait lives in memory)
 *   cancel() / status()
 *
 * A hive that runs the image is updated by its host instead: deploy/hive.sh update <name> --file <path>.
 */
const fs = require('fs');
const path = require('path');
const store = require('../store');
const manifest = require('./manifest');

const DOC = 'update-channel/state';
const LABEL = tag => `update from a file to ${tag}`;
const NEVER_CUT_MS = 30 * 24 * 3600e3;   // as the channel: an update waits far past any turn, never cuts one

const state = () => store.readJson(DOC, {});
const save = patch => { const s = { ...state(), ...patch }; store.writeJson(DOC, s); return s; };
const running = () => require('../../package.json').version;
const drain = () => require('../harness/drain');
const ours = () => { const p = drain().pending(); return p && /^update from a file to /.test(p.label) ? p : null; };
const note = (what, why = '', level = 'info') => { try { require('../activity').note({ from: 'updates', what, why, level }); } catch { /* a record */ } };
const refuse = (why, status = 409) => Object.assign(new Error(why), { status });
const hooks = () => require('./index').hooks;

/** Where an uploaded file is kept while it is read; removed after. */
const uploads = () => path.join(store.DATA_DIR, 'update-channel', 'uploads');

async function install(file, { older = false, by = 'a person', say = () => {} } = {}) {
  if (require('../hosted').on()) throw refuse('This hive runs an image: its host installs an update file (deploy/hive.sh update <name> --file <path>), holding the hive\'s work.');
  if (!process.env.DOCA_HOME) throw refuse('This panel was not started by DOCA\'s launcher (bin/doca-launch.js start, which run.sh, the installers and the boot entry use), so nothing could switch to the new version or go back if it fails. Start it that way and try again.');
  const f = require('./update-file').open(file);
  const v = f.manifest.version, now = running(), c = manifest.cmp(v, now);
  if (c === 0) throw refuse(`${v} is the version running now.`);
  if (c < 0 && !older) throw refuse(`The file is ${v}, older than ${now}, which runs here. To go back to it, tick "Go back to this version" and install it again.`);
  if (Number(f.manifest.dataFormat || 1) < store.dataFormat())
    throw refuse(`${v} writes data format ${f.manifest.dataFormat || 1}, and this hive's data is already format ${store.dataFormat()}: it could damage the data. Restore a backup made on that version instead.`);
  fs.mkdirSync(uploads(), { recursive: true });
  const zip = path.join(uploads(), `doca-${v}.zip`);
  let tag;
  try {
    require('./update-file').extract(file, f.zip, zip);
    tag = await require('./stage').stage({ manifest: f.manifest, signature: f.signature, keyId: f.keyId }, zip, { say, deps: hooks().deps, from: 'file' });
  } finally { fs.rmSync(zip, { force: true }); }
  save({ file: { version: v, tag, from: now, by, older: c < 0, at: new Date().toISOString() }, failed: null });
  note(`staged ${tag} from an update file`, `${c < 0 ? 'going back' : 'from'} ${now}, signed by ${f.keyId || 'a release key'}; it is switched to once nothing runs`);
  wait(tag);
  return status();
}

/** The switch, once idle — the channel's own road (releases.use, the launcher's 90 s watch, outcome()). */
async function go(tag) {
  const s = state();
  if (s.file?.tag !== tag) return;   // called off while waiting
  save({ file: null, applying: { version: tag.slice(1), from: running(), since: new Date().toISOString(), why: `installed from an update file by ${s.file.by}` } });
  note(`switching to ${tag}`, 'from an update file; nothing was running');
  try { await require('../releases').use(tag, { by: 'update file', restart: false }); }
  catch (e) { save({ applying: null, file: { ...s.file, error: e.message } }); throw e; }
  setTimeout(() => hooks().restart(), 300);
}

// One wait at a time (harness/drain.js): a person's file replaces a channel update that was waiting, and the channel
// does not replace it back (index.js tick).
function wait(tag) {
  drain().whenIdle(() => go(tag).catch(e => note(`the switch to ${tag} did not happen: ${e.message}`, '', 'error')), { label: LABEL(tag), maxWaitMs: NEVER_CUT_MS });
}

function resume() {
  const f = state().file;
  if (!f || f.error || ours()) return;
  if (f.version === running() || !require('./stage').verified(path.join(require('../releases').DIR, f.tag))) { save({ file: null }); return; }
  wait(f.tag);
}

function cancel() {
  const had = ours();
  if (had) drain().cancel();
  const f = state().file;
  save({ file: null });
  if (f) note(`the update from a file to ${f.tag} was called off`, 'it stays staged; nothing was switched');
  return { cancelled: !!(had || f), ...status() };
}

function status(s = state()) {
  const w = ours();
  return { running: running(), file: s.file || null, waiting: w ? { since: w.since, on: w.waitingOn.map(x => x.title) } : null,
    outcome: s.outcome || null, failed: s.failed || null, image: require('../hosted').on(), launcher: !!process.env.DOCA_HOME };
}

module.exports = { install, resume, cancel, status, uploads, LABEL };
