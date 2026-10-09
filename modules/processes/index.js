'use strict';

/**
 * The Processes drawer (asked 2026-10-09: "an eye on other existing non-system processes" — the owner runs many
 * projects from many sources on this machine). What a person started on the hub's machine, grouped by where it comes
 * from (group.js), the system's own left out (system.js) unless asked. Read only: nothing here stops a process —
 * stopping stays with the machine rows and their confirmations.
 *
 * Read only while a drawer is open: a request asks (`want`), the table is read every LOOK_MS while someone asked in the
 * last WANT_MS, and nothing after — the readings are dropped, so the next open starts fresh. Nothing is written to disk.
 * CPU is a share of one core between two readings of the same process (its pid and start time); the first reading of
 * one has none. The command line is masked (busy-read.maskCommand, and any long random word); the environment is never
 * read. Mechanical: OS readings in fixed words — no model is asked anything, and no agent tool reads this (the agent
 * has system_status). A host's: `GET /api/machines/processes` with the rest of /api/machines.
 */
const T = { lookMs: 3000, wantMs: 30000 };
const READERS = { linux: './read-linux', darwin: './read-darwin', win32: './read-win32' };

let _asked = 0, _timer = null, _running = null, _last = null, _prev = new Map(), _looks = 0, _override = null;

const reader = (os = process.platform) => _override || require(READERS[os] || READERS.linux);

/** A command line as it may be shown: busy-read's masks, then any long random-looking word on its own. */
function mask(args) {
  const list = require('../machines/busy-read').maskCommand(args || []);
  const { MASK } = require('../secrets-mask');
  return list.map((a, i) => (i > 0 && a.length >= 28 && /^[A-Za-z0-9+/_=-]+$/.test(a) && /\d/.test(a) && /[A-Za-z]/.test(a) && !/^-/.test(a) ? MASK : a))
    .join(' ');
}

/** CPU % of one core for each process against the last reading. */
function withCpu(table) {
  const next = new Map();
  for (const p of table.procs) {
    const was = _prev.get(p.pid);
    const same = was && Math.abs(was.startedAt - p.startedAt) < 2000;
    p.cpu = same && table.at > was.at ? Math.max(0, Math.round(((p.cpuMs - was.cpuMs) / (table.at - was.at)) * 1000) / 10) : null;
    next.set(p.pid, { cpuMs: p.cpuMs, startedAt: p.startedAt, at: table.at });
  }
  _prev = next;
  return table;
}

/** One reading: the table, each row's system reason and container, and the ports of what is shown. */
async function look() {
  if (_running) return _running;
  _running = (async () => {
    const r = reader(), os = r.OS || process.platform, sys = require('./system');
    const { names, uidMin } = r.accounts();
    const table = withCpu(await r.read());
    for (const p of table.procs) {
      p.containerId = sys.containerOf(p.cgroup);
      p.system = sys.reason(p, { os, uidMin });
      if (p.uid != null && !p.user) p.user = names.get(p.uid) || null;
    }
    const ports = await r.listening(table.procs.filter(p => !p.system).map(p => p.pid)).catch(() => new Map());
    _last = { ...table, ports };
    _looks++;
    return _last;
  })();
  try { return await _running; } finally { _running = null; }
}

const wanted = () => Date.now() - _asked < T.wantMs;

async function tick() {
  _timer = null;
  if (!wanted()) return stop();
  try { await look(); } catch { /* the next look tries again */ }
  if (!wanted()) return stop();
  _timer = setTimeout(tick, T.lookMs);
  _timer.unref?.();
}

/** Nobody looks any more: stop reading, and forget the readings. */
function stop() {
  clearTimeout(_timer);
  _timer = null;
  _last = null;
  _prev = new Map();
  try { require('./context')._reset(); require(READERS[process.platform] || READERS.linux)._reset?.(); } catch { /* nothing kept */ }
}

/** A drawer is open: keep reading for a while. */
function want() {
  _asked = Date.now();
  if (!_timer && !_running) { _timer = setTimeout(tick, T.lookMs); _timer.unref?.(); }
}

/** What the drawer shows: the groups, and how the reading goes. `system`: list the system's own too. */
async function snapshot({ system = false } = {}) {
  want();
  const t = _last || await look();
  const ctx = await require('./context').gather();
  const out = require('./group').group(t.procs, { ...ctx, os: t.os, ports: t.ports, system, mask });
  return { ...out, os: t.os, at: t.at, everyMs: T.lookMs, stopsAfterMs: T.wantMs, rules: require('./system').RULES[t.os] || [] };
}

function mount(app) {
  app.get('/api/machines/processes', async (req, res) => {
    try { res.json(await snapshot({ system: req.query.system === '1' })); } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { mount, snapshot, look, want, stop, mask, wanted, T, looks: () => _looks, reading: () => !!_timer || !!_running,
  _reset: () => { stop(); _asked = 0; _looks = 0; },
  _useReader: r => { _override = r; } };   // a test's stand-in for the OS (test/processes.test.js)
