'use strict';

/**
 * The update channel of a production hive (docs/design/production.md; the owner, 2026-10-09: "when we publish solutions
 * in main the customers can get the update; we can update them remotely, holding their work the time necessary, or
 * scheduling — still holding even when scheduled"). A development hive keeps its git-based updates and ignores this.
 *
 *   check()     ask the licence server for releases newer than the running one (source.js), keep the newest that
 *               verifies, and whether any of them is urgent and by when
 *   tick()      every minute: check every six hours; when an update is due — the person asked ("Update now"), the
 *               window is open (`updates.auto: window`), or an urgent release's `applyBy` has passed — stage it
 *               (download, verify, unpack, dependencies) and switch to it **once nothing runs**: turns, calls and
 *               devices' commands are never cut (harness/drain.js, waited on without a deadline that would cut them).
 *               A window that closes before the hive is idle calls the wait off until the next one.
 *   outcome     after the restart: the version running is the one switched to (applied), or the launcher put the
 *               old one back after 90 s (failed) — said in the activity log and as a notice to the hive's admins; a
 *               failed version is not tried again by itself.
 *
 * A hive running the image (hosted.js) does not stage anything: its host swaps the image (deploy/hive.sh update),
 * and the hive holds its work for that (hold.js). It still checks, so its admin sees what is coming.
 */
const store = require('../store');
const DOC = 'update-channel/state';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const CHECK_MS = 6 * 3600e3;
const NEVER_CUT_MS = 30 * 24 * 3600e3;   // drain.whenIdle goes ahead at its deadline: an update waits far past any turn

const state = () => store.readJson(DOC, {});
const save = patch => { const s = { ...state(), ...patch }; store.writeJson(DOC, s); return s; };
const running = () => require('../../package.json').version;
const on = () => require('../edition-mode').production();
const imageHive = () => require('../hosted').on();
const value = k => require('../settings-schema').value(`updates.${k}`);
const note = (what, why = '', level = 'info') => { try { require('../activity').note({ from: 'updates', what, why, level }); } catch { /* a record */ } };
const tell = (title, text) => { try { require('../notices').post({ title, text, from: 'updates' }); } catch { /* a record */ } };

function settings() {
  return { auto: value('auto'), days: value('days').filter(d => DAYS.includes(d)), from: value('from'), to: value('to') };
}

/** Whether `now` (the hive's own clock) is inside the update window. A window may run past midnight. */
function inWindow(cfg = settings(), now = new Date()) {
  const min = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s)); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  const from = min(cfg.from), to = min(cfg.to);
  if (from === null || to === null) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  const day = d => cfg.days.includes(DAYS[(d + 7) % 7]);
  if (from <= to) return day(now.getDay()) && t >= from && t < to;
  return (t >= from && day(now.getDay())) || (t < to && day(now.getDay() - 1));   // e.g. 23:00–02:00 starts the day before
}

async function check() {
  if (!on()) return { ok: false, development: true, why: 'A development hive updates from git (Settings → General → Updates).' };
  const at = new Date().toISOString();
  try {
    const { releases, skipped } = await require('./source').newer(running());
    const latest = releases[0] || null;
    const urgent = releases.filter(r => r.manifest.urgent);
    const applyBy = urgent.map(r => r.manifest.applyBy).filter(Boolean).sort()[0] || (urgent.length ? at : null);
    const was = state().latest?.version || null;
    const s = save({ lastCheck: at, lastError: null, latest, urgent: urgent.length ? { versions: urgent.map(r => r.version), applyBy } : null, skipped });
    if (latest && latest.version !== was) {
      note(`found ${latest.version} on the update channel`, urgent.length ? `urgent: applied after ${applyBy.slice(0, 10)}, holding running work` : '');
      tell(`${require('../branding').name('product')} ${latest.version} is ready`, urgent.length
        ? `An urgent update: it is applied at the first quiet moment after ${applyBy.slice(0, 16).replace('T', ' ')}, never cutting running work. Settings → General → Updates.`
        : 'Settings → General → Updates installs it now or in the window you choose; running work is never cut.');
    }
    return { ok: true, ...status(s) };
  } catch (e) {
    save({ lastCheck: at, lastError: e.message });
    return { ok: false, why: e.message, ...status() };
  }
}

/** Why an update is due now, or null. */
function dueWhy(s = state(), now = Date.now()) {
  if (!s.latest || imageHive()) return null;
  if (s.failed?.version === s.latest.version && !s.requested) return null;   // put back after it failed: a person asks again
  if (s.requested) return 'asked for now';
  if (s.urgent?.applyBy && now >= Date.parse(s.urgent.applyBy)) return `urgent, due since ${s.urgent.applyBy.slice(0, 16).replace('T', ' ')}`;
  if (settings().auto === 'window' && inWindow(settings(), new Date(now))) return 'inside the update window';
  return null;
}

const LABEL = v => `update to ${v}`;
const ours = () => { const p = require('../harness/drain').pending(); return p && /^update to /.test(p.label) ? p : null; };

let _staging = null;
async function stageLatest(say = () => {}) {
  const s = state();
  if (s.staged === `v${s.latest.version}` && require('./stage').verified(require('path').join(require('../releases').DIR, s.staged))) return s.staged;
  if (_staging) return _staging;
  _staging = (async () => {
    const dir = require('path').join(store.DATA_DIR, 'update-channel', 'downloads');
    require('fs').mkdirSync(dir, { recursive: true });
    const file = require('path').join(dir, s.latest.manifest.file || `doca-${s.latest.version}.zip`);
    say(`Downloading ${s.latest.version}…\n`);
    await require('./source').download(s.latest, file);
    const tag = await require('./stage').stage(s.latest, file, { say, deps: module.exports.hooks.deps });
    require('fs').rmSync(file, { force: true });
    save({ staged: tag, stageError: null });
    note(`staged ${tag}`, 'downloaded, verified and unpacked beside the running version; it is switched to once nothing runs');
    return tag;
  })().finally(() => { _staging = null; });
  return _staging;
}

/** The switch itself, once idle: through releases.use, whose launcher puts the old version back if this one does not answer. */
async function go(tag, why) {
  const s = state();
  if (!dueWhy(s) && !s.requested) return;   // the window closed, or it was called off, while waiting
  save({ requested: false, applying: { version: tag.slice(1), from: running(), since: new Date().toISOString(), why } });
  note(`switching to ${tag}`, `${why}; nothing was running`);
  try { await require('../releases').use(tag, { by: 'update channel', restart: false }); }
  catch (e) { save({ applying: null }); throw e; }
  setTimeout(() => module.exports.hooks.restart(), 300);
}

async function tick(now = Date.now()) {
  if (!on()) return;
  const s = state();
  if (!s.lastCheck || now - Date.parse(s.lastCheck) >= CHECK_MS) await check();
  const why = dueWhy(state(), now);
  const waiting = ours();
  if (!why) { if (waiting) { require('../harness/drain').cancel(); note('the update waits for the next window', 'the window closed before the hive was idle; nothing was cut'); } return; }
  if (waiting) return;
  let tag;
  try { tag = await stageLatest(); } catch (e) { save({ stageError: e.message, requested: false }); note(`could not stage ${state().latest?.version}: ${e.message}`, '', 'warn'); return; }
  require('../harness/drain').whenIdle(() => go(tag, why).catch(e => note(`the switch to ${tag} did not happen: ${e.message}`, '', 'error')),
    { label: LABEL(tag), maxWaitMs: NEVER_CUT_MS });
}

/** A person's "Update now": staged at once, switched to as soon as nothing runs. */
async function now() {
  if (!on()) throw Object.assign(new Error('A development hive updates from git.'), { status: 409 });
  if (imageHive()) throw Object.assign(new Error('This hive runs an image: its host updates it (deploy/hive.sh update), and the hive holds its work for that.'), { status: 409 });
  if (!state().latest) await check();
  if (!state().latest) throw Object.assign(new Error('There is no newer release to install.'), { status: 409 });
  save({ requested: true, failed: null });
  await tick();
  return status();
}

function cancel() {
  const had = ours();
  if (had) require('../harness/drain').cancel();
  save({ requested: false });
  return { cancelled: !!had, ...status() };
}

/** After a start: did the switch the channel made hold? */
function outcome() {
  const s = state();
  if (!s.applying) return null;
  const v = s.applying.version, ok = running() === v;
  if (ok) { note(`updated to ${v}`, `from ${s.applying.from}: ${s.applying.why}`); save({ applying: null, failed: null, staged: null, outcome: { ok, version: v, at: new Date().toISOString() } }); }
  else {
    note(`the update to ${v} did not start; ${running()} runs again`, 'the launcher switched back after 90 s (.releases/log.jsonl)', 'error');
    tell(`The update to ${v} did not start`, `${require('../branding').name('product')} went back to ${running()} by itself. It is not tried again until someone asks (Settings → General → Updates).`);
    save({ applying: null, failed: { version: v, at: new Date().toISOString() }, outcome: { ok, version: v, at: new Date().toISOString() } });
  }
  return { ok, version: v };
}

function status(s = state()) {
  const w = ours();
  return { production: on(), image: imageHive(), running: running(), settings: settings(), inWindow: inWindow(),
    latest: s.latest ? { version: s.latest.version, notes: s.latest.manifest.notes || '', urgent: !!s.latest.manifest.urgent, image: s.latest.manifest.image || null } : null,
    urgent: s.urgent || null, lastCheck: s.lastCheck || null, lastError: s.lastError || null, staged: s.staged || null, stageError: s.stageError || null,
    requested: !!s.requested, failed: s.failed || null, outcome: s.outcome || null, skipped: s.skipped || [],
    waiting: w ? { since: w.since, on: w.waitingOn.map(x => x.title) } : null, due: dueWhy(s), channel: require('./source').where() };
}

let _timer = null;
function start() {
  if (!on() || _timer) return;
  outcome();
  if (imageHive()) require('./hold').start();
  _timer = setInterval(() => tick().catch(e => note(`the update channel: ${e.message}`, '', 'warn')), 60e3);
  _timer.unref?.();
  setTimeout(() => tick().catch(() => {}), 60e3).unref?.();
}
const stop = () => { clearInterval(_timer); _timer = null; require('./hold').stop(); };

// The restart after a switch, through the launcher (releases.restartSelf), and npm ci for a staged version; a test stands in for both.
const hooks = { restart: () => require('../releases').restartSelf(), deps: undefined };

module.exports = { check, tick, now, cancel, outcome, status, settings, inWindow, dueWhy, stageLatest, start, stop, hooks, DAYS };
