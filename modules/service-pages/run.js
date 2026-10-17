'use strict';

/**
 * Starting a connected service's program, and starting it with DOCA (asked 2026-10-15: "a setting 'start at boot' to
 * toggle"). An admin gives the service how it starts — a command and its arguments (by argv, never a shell line), a
 * working folder and an optional settings file of KEY=value lines — the way an MCP server is given one; "Start with
 * DOCA" then starts it when DOCA starts, if it is not answering already. The program runs outside DOCA's own process
 * group (outlive.js: under systemd, a unit of the person's own), so a restart or a version switch of DOCA does not take
 * it down; when DOCA really stops, it stops too (service-life/shutdown.js — the owner's rule of 2026-10-17: what the
 * panel started goes down with it unless asked to stay up). Its PID is kept in DATA_DIR/service-pages/ and Stop ends
 * exactly that process (and its group), never one found by name. Output goes to a log file beside it.
 */
const fs = require('fs');
const path = require('path');

const dir = () => { const d = require('../store').dir('service-pages'); fs.mkdirSync(d, { recursive: true }); return d; };
const pidFile = id => path.join(dir(), `${id}.pid`);
const logFile = id => path.join(dir(), `${id}.log`);
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

/** KEY=value lines (a value may be quoted; # starts a comment); nothing is run or expanded. */
function readEnvFile(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** The PID this hub started for the service, when that process is still alive; else null. */
function running(id) {
  try {
    const pid = Number(fs.readFileSync(pidFile(id), 'utf8'));
    if (pid > 0) { process.kill(pid, 0); return pid; }
  } catch { /* none, or gone */ }
  return null;
}

/** Check an admin's "how it starts": a command, arguments as a list, a folder and a settings file that exist. */
function checkRun(run) {
  if (!run || !String(run.command || '').trim()) return null;
  const r = { command: String(run.command).trim(), args: (Array.isArray(run.args) ? run.args : String(run.args || '').split(/\r?\n/)).map(String).map(s => s.trim()).filter(Boolean),
    cwd: String(run.cwd || '').trim() || null, envFile: String(run.envFile || '').trim() || null };
  if (r.cwd && !fs.existsSync(r.cwd)) throw bad(`No folder ${r.cwd}.`);
  if (r.envFile && !fs.existsSync(r.envFile)) throw bad(`No settings file ${r.envFile}.`);
  return r;
}

function start(s, why = 'an admin') {
  if (!s.run?.command) throw bad(`${s.name} has no way to start it here: give its command in Field → Connectors → Services with a page.`, 409);
  const was = running(s.id);
  if (was) return { started: false, pid: was, why: 'already running' };
  const env = { ...process.env, ...(s.run.envFile ? readEnvFile(s.run.envFile) : {}) };
  const { pid } = require('../outlive').start({ file: s.run.command, args: s.run.args || [], cwd: s.run.cwd || undefined, env, log: logFile(s.id), unit: `doca-service-${s.id}` });
  if (pid) fs.writeFileSync(pidFile(s.id), String(pid));
  require('../activity').note({ from: 'services', what: pid ? `started ${s.name} (pid ${pid})` : `started ${s.name}, and it ended at once (its log says why)`, why, machine: { kind: 'service-page', id: s.id, name: s.name }, act: 'start' });
  return { started: !!pid, pid: pid || null };
}

function stop(s, why = 'an admin') {
  const pid = running(s.id);
  if (!pid) return { stopped: false, why: 'not started by this hub' };
  try { process.kill(process.platform === 'win32' ? pid : -pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
  try { fs.unlinkSync(pidFile(s.id)); } catch { /* gone */ }
  require('../activity').note({ from: 'services', what: `stopped ${s.name} (pid ${pid})`, why, machine: { kind: 'service-page', id: s.id, name: s.name }, act: 'stop' });
  return { stopped: true, pid };
}

/** DOCA really stopping (service-life/shutdown.js): every program this hub started stops. Returns the services stopped. */
function stopAll(why = 'DOCA stopped') {
  const out = [];
  let ids = [];
  try { ids = fs.readdirSync(dir()).filter(f => f.endsWith('.pid')).map(f => f.slice(0, -4)); } catch { return out; }
  for (const id of ids) {
    if (!running(id)) continue;
    let s = null;
    try { s = require('./index').get(id); } catch { /* removed since */ }
    try { stop(s || { id, name: id }, why); out.push(id); } catch { /* gone */ }
  }
  return out;
}

/** When DOCA starts: every service marked to start with it, unless it answers already (started some other way). */
async function boot() {
  const services = require('./index'), health = require('./health');
  for (const s of services.all().filter(x => x.boot && x.run?.command)) {
    try {
      if ((await health.check(s)).up) continue;
      start(s, 'it starts with DOCA');
    } catch (e) { console.warn(`[service-pages] ${s.id}: ${e.message}`); }
  }
  setTimeout(() => health.checkAll().catch(() => {}), 8000).unref?.();   // the page appears once it answers
}

const tail = (id, n = 40) => { try { return fs.readFileSync(logFile(id), 'utf8').split('\n').slice(-n).join('\n'); } catch { return ''; } };

module.exports = { start, stop, stopAll, running, boot, checkRun, readEnvFile, tail, logFile };
