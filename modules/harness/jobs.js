'use strict';

/**
 * Background commands: a build, an install, a download — anything longer than
 * a `shell` call may wait for (`shellTimeoutSec`).
 *
 * Before this the agent split `sleep 150` into three calls, or watched a
 * command die at 60 s halfway through a model download. A job starts, returns
 * its id at once, and runs on with its output in a log file; `shell_job` reads
 * how it stands, its output, or stops it. Jobs outlive the turn, and a restart or
 * an update of DOCA (outlive.js: under systemd, a unit of the person's own, so the
 * panel's restart cannot reach them); when DOCA really stops they stop with it,
 * unless one was started with `keep` (the person asked for it to stay up) — the
 * owner's rule of 2026-10-17, carried out by service-life/shutdown.js. A job's
 * exit code is written beside its log, so it is known after a restart too.
 *
 * Kept in `<DATA_DIR>/harness/jobs.json`, logs in `<DATA_DIR>/harness/jobs/`.
 */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const store = require('../store');
const shell = require('../shell');

const MAX_RUNNING = 8;
const KEEP = () => require('../log-keep').limit('logs.jobsKept');   // job records kept; the oldest finished ones go, with their logs
const TAIL = 8000;           // output read back by default, from the end

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function rows() { return store.readJson('harness/jobs', { jobs: [] }).jobs; }
function save(list) { store.writeJson('harness/jobs', { jobs: list.slice(-Math.max(KEEP(), list.filter(j => j.state === 'running').length)) }); }
function update(id, patch) { save(rows().map(j => (j.id === id ? { ...j, ...patch } : j))); }
const logOf = id => path.join(store.dir('harness/jobs'), `${id}.log`);
const codeOf = id => path.join(store.dir('harness/jobs'), `${id}.code`);
const codeRead = id => { try { const t = fs.readFileSync(codeOf(id), 'utf8').trim(); return t === '' ? null : Number(t); } catch { return null; } };

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Jobs this process started whose 'exit' has not arrived yet: a dead pid here
// is an exit on its way, not a restart that lost it.
const waiting = new Set();

/** Where a job stands: running, exited (with its code, from its own file when DOCA was not its parent), stopped, or
 *  gone (it ended where nothing could say how). */
function view(j) {
  if (j.state !== 'running' || waiting.has(j.id) || alive(j.pid)) return { ...j };
  const code = codeRead(j.id);
  return code == null ? { ...j, state: 'gone' } : { ...j, state: 'exited', code };
}

function start(command, { cwd, sessionId = null, env, keep = false } = {}) {
  if (!String(command || '').trim()) throw bad('command is required');
  if (require('../hosted').on()) throw require('../hosted').refusal('A command line on the hub');   // hosted.js
  const running = rows().map(view).filter(j => j.state === 'running');
  if (running.length >= MAX_RUNNING)
    throw bad(`${MAX_RUNNING} background jobs are already running (${running.map(j => j.id).join(', ')}). Wait for one, or stop one with shell_job.`, 409);

  const id = `job_${crypto.randomBytes(5).toString('hex')}`;
  const log = logOf(id);
  // Its own process group, so stopping it stops what it started too; outside DOCA's own group (outlive.js), so a
  // restart or an update does not end it. DOCA_JOB tells what runs that it is a background job (a script that must not
  // run in the foreground checks it: skills/product-video's promo.js start).
  const s = shell.spec();
  const line = shell.WIN ? command : require('../outlive').withCode(command, codeOf(id));
  const { pid, unit, child } = require('../outlive').start({ file: s.file, args: [...s.args, line], cwd, log, unit: `doca-job-${id}`,
    env: { ...(env || process.env), DOCA_JOB: id } });

  const job = { id, command: String(command).slice(0, 2000), cwd: cwd || null, pid: pid || null, ...(unit ? { unit } : {}), ...(keep ? { keep: true } : {}),
    sessionId, state: 'running', startedAt: new Date().toISOString() };
  // Oldest finished jobs go first, and their logs with them.
  trim([...rows(), job]);

  if (child) {   // DOCA's own child (not a unit): its exit is heard here
    waiting.add(id);
    child.on('error', e => { update(id, { state: 'exited', code: -1, endedAt: new Date().toISOString(), error: e.message }); waiting.delete(id); });
    child.on('exit', (code, signal) => {
      const cur = rows().find(j => j.id === id);
      if (cur?.state !== 'stopped') update(id, { state: 'exited', code: code ?? null, signal: signal || undefined, endedAt: new Date().toISOString() });
      waiting.delete(id);
    });
  }
  return view(job);
}

/** Over `logs.jobsKept`: the oldest finished records go, with their output. Returns how many went. */
function trim(all = rows()) {
  const keep = KEEP();
  const drop = all.length > keep ? all.filter(j => j.state !== 'running').slice(0, all.length - keep) : [];
  for (const d of drop) { fs.rmSync(logOf(d.id), { force: true }); fs.rmSync(codeOf(d.id), { force: true }); }
  save(all.filter(j => !drop.includes(j)));
  return drop.length;
}

/** The bound applied now, and output files no record names (a record dropped before its file) removed. */
function prune() {
  const n = trim();
  const known = new Set(rows().map(j => `${j.id}.log`));
  let stray = 0;
  try {
    for (const f of fs.readdirSync(store.dir('harness/jobs'))) {
      const m = /^(.+)\.(log|code)$/.exec(f);
      if (m && !known.has(`${m[1]}.log`)) { fs.rmSync(path.join(store.dir('harness/jobs'), f), { force: true }); if (m[2] === 'log') stray++; }
    }
  } catch { /* none */ }
  return n + stray;
}

function get(id) {
  const j = rows().find(x => x.id === id);
  if (!j) throw bad(`No background job "${id}".`, 404);
  return view(j);
}

/** The end of its output (or `bytes` from the end). */
function output(id, bytes = TAIL) {
  get(id);
  const log = logOf(id);
  let size = 0;
  try { size = fs.statSync(log).size; } catch { return ''; }
  const n = Math.min(size, Math.max(1, Number(bytes) || TAIL));
  const buf = Buffer.alloc(n);
  const fd = fs.openSync(log, 'r');
  try { fs.readSync(fd, buf, 0, n, size - n); } finally { fs.closeSync(fd); }
  return (n < size ? `…(${size - n} earlier bytes not shown)\n` : '') + buf.toString('utf8');
}

function stop(id) {
  const j = get(id);
  if (j.state !== 'running') return j;
  // Windows has no process groups: the shell's tree (a dev server it started) goes with taskkill /T, or it outlives the job.
  if (shell.WIN) try { require('child_process').execFileSync('taskkill', ['/PID', String(j.pid), '/T', '/F'], { stdio: 'ignore', timeout: 10000 }); } catch { /* already gone */ }
  else try { process.kill(-j.pid, 'SIGTERM'); } catch {
    try { process.kill(j.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  update(id, { state: 'stopped', endedAt: new Date().toISOString() });
  return get(id);
}

/** DOCA really stopping (service-life/shutdown.js): every running job not started with `keep` stops. Returns their ids. */
function stopUnkept() {
  const out = [];
  for (const j of rows().map(view)) if (j.state === 'running' && !j.keep) { try { stop(j.id); out.push(j.id); } catch { /* gone */ } }
  return out;
}

function list({ sessionId } = {}) {
  return rows().filter(j => !sessionId || j.sessionId === sessionId).map(view).reverse();
}

module.exports = { start, get, output, stop, stopUnkept, list, prune, MAX_RUNNING, KEEP };
