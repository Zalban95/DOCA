'use strict';

/**
 * When the OpenTelemetry receiver runs (receiver.js): while "Other agents on this machine" is on, its OpenTelemetry part
 * is on (`outsideAgents.otel`), and an agent that speaks OpenTelemetry — Claude Code, Codex, Gemini CLI — is running
 * for this account; a minute after the last one ends it closes. Which agents run is read from the process table every
 * CHECK_MS (workstream/outside.js's reading, shared), only while switched on. Each opening and closing is an activity
 * line (activity.js), so the listener is never running unseen.
 */
const T = { checkMs: 15000, graceMs: 60000 };
let _server = null, _port = null, _timer = null, _lastSeen = 0, _running = [], _why = null;
const counts = { requests: 0, records: 0, steps: 0 };

/** The process table (replaceable in tests). */
let source = () => require('../../workstream/outside').table();

const P = () => { try { return require('../../branding').name('product'); } catch { return 'DOCA'; } };
const setting = k => { try { return require('../../settings-schema').value(`outsideAgents.${k}`); } catch { return null; } };
const wanted = () => require('../index').enabled() && setting('otel') !== false;
const note = (what, why, level = 'info') => { try { require('../../activity').note({ from: 'outside-agents', what, why, level }); } catch { /* never in the way */ } };

/** The agents running now for this account, outside DOCA: [{ agent, label, pid, cwd }]. */
async function scan() {
  const t = await source().catch(() => null);
  if (!t) return _running;
  const { program } = require('../../workstream/notable');
  const agents = require('../index').AGENTS;
  const byPid = new Map(t.procs.map(p => [p.pid, p]));
  const own = p => { for (let q = p, n = 0; q && n < 64; q = byPid.get(q.ppid), n++) if (q.pid === process.pid) return true; return false; };
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const out = [];
  for (const p of t.procs) {
    if (p.system || p.containerId || (uid != null && p.uid != null && p.uid !== uid) || own(p)) continue;
    const a = agents.find(x => x.programs.includes(program(p)));
    const parent = byPid.get(p.ppid);
    if (a && !(parent && program(parent) === program(p))) out.push({ agent: a.id, label: a.label, pid: p.pid, cwd: p.cwd || null });
  }
  return out;
}

async function open(port) {
  if (_server) return;
  try {
    _server = await require('./receiver').listen(port, (kind, steps, records) => {
      counts.requests++; counts.records += records; counts.steps += steps.length;
      return require('../index').ingest(steps);
    });
    _port = port; _why = null;
    note(`the OpenTelemetry receiver listens on 127.0.0.1:${port}`, `${[...new Set(_running.map(r => r.label))].join(', ')} running, and "Other agents on this machine" is on`);
  } catch (e) {
    _server = null; _why = `could not listen on 127.0.0.1:${port} (${e.code || e.message})`;
    note('the OpenTelemetry receiver did not start', _why, 'warn');
  }
}

async function close(why) {
  if (!_server) return;
  const s = _server, port = _port;
  _server = null; _port = null; _why = why;
  await new Promise(r => { s.close(() => r()); s.closeAllConnections?.(); });
  note(`the OpenTelemetry receiver on 127.0.0.1:${port} closed`, why);
}

/** Look once: open, keep or close the listener — one look at a time (a hold and a save at once opened it twice). */
let _chain = Promise.resolve();
function check() {
  const run = _chain.then(checkNow, checkNow);
  _chain = run.catch(() => {});
  return run;
}

async function checkNow() {
  if (!wanted()) { clearTimeout(_timer); _timer = null; _running = []; await close('switched off'); return state(); }
  _running = await scan();
  const port = Number(setting('otelPort')) || 4318;
  if (_running.length) _lastSeen = Date.now();
  if (_server && _port !== port) await close(`its port changed to ${port}`);
  if (_running.length && !_server) await open(port);
  else if (_server && Date.now() - _lastSeen > T.graceMs) await close(`no agent that speaks OpenTelemetry has run here for a minute`);
  else if (!_server && !_running.length) _why = `waiting for an agent that speaks OpenTelemetry (${P()} opens it when one runs)`;
  return state();
}

async function loop() {
  _timer = null;
  try { await check(); } catch { /* the next look */ }
  if (!wanted()) return;
  _timer = setTimeout(loop, T.checkMs);
  _timer.unref?.();
}

/** Follow the switch now (a save, a hold, the start of the hub): looks at once, then every CHECK_MS while on. */
async function sync() {
  clearTimeout(_timer); _timer = null;
  await loop();
  return state();
}

function state() {
  return { wanted: wanted(), listening: _server ? { address: '127.0.0.1', port: _port } : null, why: _server ? null : _why,
    running: _running.map(r => ({ agent: r.agent, label: r.label, pid: r.pid })), counts: { ...counts } };
}

/** Where an agent works, when one of it runs (its process's folder) — for a step OpenTelemetry sent without one. */
function cwdOf(agent) {
  const list = _running.filter(r => r.agent === agent && r.cwd);
  return list.length === 1 ? list[0].cwd : null;
}

module.exports = { sync, check, state, cwdOf, running: () => _running.slice(), T,
  _source: fn => { source = fn; }, _stop: async () => { clearTimeout(_timer); _timer = null; await close('stopped'); _lastSeen = 0; _running = []; } };
