'use strict';

/**
 * Work on this machine outside DOCA, as Workstream lines (asked 2026-10-10: helpers outside DOCA — Claude Code
 * sessions, test runs, Android emulators, docker builds — were busy all evening, and the Workstream said nothing). While
 * a page holds the Workstream it reads the process table every LOOK_MS (processes/, the drawer's own reader) and says,
 * in fixed words, when a process of note (notable.js) starts or ends — grouped by where it works: the project, the
 * repository its folder is in, else "outside DOCA". The first look says what is already running. What DOCA itself runs
 * (this hub's own children: an agent's job, a smoke test's browser) is the agents' own line already and left out.
 * Mechanical, all of it: OS readings in fixed templates; no model is asked anything and no agent posts here.
 *
 * The same reading names who wrote a file (who.js): the table is kept CACHE_MS and shared.
 */
const P = () => { try { return require('../branding').name('product'); } catch { return 'DOCA'; } };   // the product's name (branding.js)
const T = { lookMs: 10000, cacheMs: 5000 };
const MAX_LINES = 12;   // per look: a burst (forty test workers) is a count, not forty lines

let _timer = null, _first = true, _table = null, _reading = null;
const _known = new Map();   // `${pid}:${startedAt}` → { kind, label, what, where, startedAt }

/** The process table, at most CACHE_MS old (shared with who.js); `fresh`: read again unless it is under a second old. */
async function table({ fresh = false } = {}) {
  const age = _table ? Date.now() - _table.at : Infinity;
  if (age < (fresh ? 1000 : T.cacheMs)) return _table;
  const gen = _gen;
  if (!_reading) {
    // processes.look() joins a reading already under way, which may have begun before what is asked about existed: read again then.
    const asked = Date.now(), look = () => require('../processes').look();
    const r = look().then(t => (t && t.at < asked ? look() : t)).then(t => { if (gen === _gen) _table = t; return t; }, () => _table)
      .finally(() => { if (_reading === r) _reading = null; });
    _reading = r;
  }
  return _reading;
}
let _gen = 0;   // a reading that lands after stop() is not kept

/** True when `p` is DOCA's own: this hub or anything below it. */
function docaOwn(p, byPid) {
  for (let q = p, n = 0; q && n < 64; q = byPid.get(q.ppid), n++) if (q.pid === process.pid) return true;
  return false;
}

/** Where a process works, as a Workstream line's `who`: the project or repository of its folder, else "Outside DOCA". */
async function whereOf(p, ctx) {
  ctx = ctx || await require('../processes/context').gather().catch(() => null);
  if (!ctx) return `Outside ${P()}`;
  const g = require('../processes/group');
  const list = g.folders(p, process.platform);
  const place = g.projectOf(list, { ...ctx, os: process.platform }) || g.repoOf(list, { ...ctx, os: process.platform });
  return place ? place.title : `Outside ${P()}`;
}

const ago = ms => (ms < 90000 ? `${Math.max(1, Math.round(ms / 1000))} s` : ms < 5400000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 3600000)} h`);
const clock = t => new Date(t).toTimeString().slice(0, 5);

/** The processes of note now (not the system's, not DOCA's own, not editors), the top of each tree only. */
function notableNow(t) {
  const { kindOf } = require('./notable');
  const byPid = new Map(t.procs.map(p => [p.pid, p]));
  const out = [];
  for (const p of t.procs) {
    if (p.system || p.containerId) continue;
    const k = kindOf(p);
    if (!k || k.kind === 'editor' || docaOwn(p, byPid)) continue;
    let parent = byPid.get(p.ppid), under = false;   // a test run's workers sit under the run: the run is the line
    for (let n = 0; parent && n < 64 && !under; parent = byPid.get(parent.ppid), n++) under = kindOf(parent)?.kind === k.kind;
    if (!under) out.push({ p, k });
  }
  return out;
}

async function look() {
  const t = await table();
  if (!t) return;
  const now = notableNow(t), keys = new Set();
  const say = require('./index').outside;
  let said = 0, ctx = null;
  for (const { p, k } of now) {
    const key = `${p.pid}:${p.startedAt}`;
    keys.add(key);
    if (_known.has(key)) continue;
    ctx = ctx || await require('../processes/context').gather().catch(() => null);
    const row = { ...k, where: await whereOf(p, ctx), startedAt: p.startedAt, pid: p.pid };
    _known.set(key, row);
    if (said++ >= MAX_LINES) continue;
    const old = _first || p.startedAt < _stoppedAt;   // there before anyone looked: running, not "started"
    say(row.where, old ? `${row.label} running since ${clock(p.startedAt)}: ${row.what} (outside ${P()}, pid ${p.pid})`
      : `${row.label} started: ${row.what} (outside ${P()}, pid ${p.pid})`, { process: { kind: k.kind, pid: p.pid } });
  }
  if (said > MAX_LINES) say(`Outside ${P()}`, `${said - MAX_LINES} more processes of note ${_first ? 'running' : 'started'}`, {});
  for (const [key, row] of [..._known]) {
    if (keys.has(key)) continue;
    _known.delete(key);
    if (!_first && !_resumed) say(row.where, `${row.label} ended after ${ago(Date.now() - row.startedAt)}: ${row.what}`, { process: { kind: row.kind, pid: row.pid, ended: true } });
  }
  _first = false; _resumed = false;
}

async function tick() {
  _timer = null;
  try { await look(); } catch { /* the next look tries again */ }
  if (!_on) return;
  _timer = setTimeout(tick, T.lookMs);
  _timer.unref?.();
}

let _on = false, _stoppedAt = 0, _resumed = false;
/**
 * The Workstream is held: look now and every LOOK_MS (idempotent). What was said before it was let go is not said again
 * (the backlog has it): a process of note there since then is "running", one that went meanwhile is dropped quietly.
 */
function start() {
  if (_on) return;
  _on = true; _first = !_known.size && !_stoppedAt; _resumed = !_first;
  _timer = setTimeout(tick, 0);
  _timer.unref?.();
}

/** Nobody holds it: stop reading (what is known stays, so holding again repeats nothing). */
function stop() {
  if (_on) _stoppedAt = Date.now();
  _on = false;
  clearTimeout(_timer); _timer = null;
  _table = null; _reading = null; _gen++;
}

module.exports = { start, stop, look, table, notableNow, whereOf, T, on: () => _on,
  _reset: () => { stop(); _known.clear(); _stoppedAt = 0; } };
