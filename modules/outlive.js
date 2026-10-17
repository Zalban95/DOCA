'use strict';

/**
 * A program DOCA starts that must outlive a restart or an update of DOCA: a background job (harness/jobs.js) — a
 * build, a download, the dev server an agent serves for a test — and a service page's program (service-pages/run.js).
 * The owner's rule (2026-10-17): what the panel started goes down when DOCA really stops, unless someone asked for it
 * to stay up; a restart or an update is not a stop, and it keeps running across one. The stop itself is
 * service-life/shutdown.js's (a SIGTERM or SIGINT, never a switch going back).
 *
 * A detached process (its own session) already outlives DOCA everywhere but under systemd: a system unit's stop kills
 * every process in its control group, so on a hub started at boot every restart and version switch ended what agents
 * had running (2026-10-17: a game an agent served went dark at the next version switch). There it is started as a
 * transient unit of the person's own systemd (`systemd-run --user`): started by their manager, never in DOCA's group,
 * its own process group as before (stopped by its PID), the environment handed over by name only — a value never
 * appears on a command line another account can read. Without a user manager to ask (no lingering, no bus) it is
 * started detached as before, and goes with DOCA's group.
 */
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
let _mode = null;

/** 'systemd-user' when DOCA runs in a systemd unit and the person's manager can be asked; otherwise 'detached'. */
function mode({ fresh = false } = {}) {
  if (_mode && !fresh) return _mode;
  _mode = 'detached';
  try {
    if (process.platform !== 'linux' || require('./hosted').on()) return _mode;
    // DOCA_OUTLIVE=detached|systemd-user chooses for a test; the second still needs a manager to ask.
    const forced = process.env.DOCA_OUTLIVE;
    if (forced === 'detached') return _mode;
    const unit = require('./self-restart').unitOf(fs.readFileSync('/proc/self/cgroup', 'utf8'));
    if (!unit && forced !== 'systemd-user') return _mode;              // not in a unit: a detached process outlives it already
    if (!require('./shell').which('systemd-run')) return _mode;
    if (!fs.existsSync(`${runtimeDir()}/bus`)) return _mode;          // no manager to ask (the person has no lingering)
    _mode = 'systemd-user';
  } catch { /* detached */ }
  return _mode;
}

const runtimeDir = () => process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 0}`;

/**
 * Start `file args` with its output appended to `log`. Returns { pid, unit }: pid is the process's own (its group's
 * leader), unit the transient unit when there is one. `codeFile`, when given, receives the exit code as text when a
 * shell command ends (the caller passes a shell line), since a unit's process is not DOCA's child to wait for.
 */
function start({ file, args = [], cwd, env = process.env, log, unit }) {
  if (mode() !== 'systemd-user') {
    const out = fs.openSync(log, 'a');
    let child;
    try { child = spawn(file, args, { cwd: cwd || undefined, env, detached: process.platform !== 'win32', stdio: ['ignore', out, out], windowsHide: true }); }
    finally { fs.closeSync(out); }
    child.on('error', () => { /* said by whoever reads its state */ });
    child.unref();
    return { pid: child.pid || null, unit: null, child };
  }
  const names = Object.keys(env).filter(k => NAME.test(k) && env[k] != null);
  const argv = ['--user', '--collect', '--quiet', `--unit=${unit}`, '-p', `StandardOutput=append:${log}`, '-p', `StandardError=append:${log}`,
    ...(cwd ? [`--working-directory=${cwd}`] : []), ...names.flatMap(k => ['-E', k]), '--', file, ...args];
  const r = spawnSync('systemd-run', argv, { env: { ...env, XDG_RUNTIME_DIR: runtimeDir(), DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDir()}/bus` }, encoding: 'utf8', timeout: 15000 });
  if (r.status !== 0) {
    // The manager refused (a unit of that name, a bus gone since): started detached, as before, rather than not at all.
    _mode = 'detached';
    return start({ file, args, cwd, env, log, unit });
  }
  return { pid: mainPid(unit), unit, child: null };
}

/** The unit's main process, 0 when it has already ended (a command that finished at once). */
function mainPid(unit) {
  try {
    const r = spawnSync('systemctl', ['--user', 'show', '-p', 'MainPID', '--value', unit],
      { env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir(), DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDir()}/bus` }, encoding: 'utf8', timeout: 5000 });
    return Number(String(r.stdout || '').trim()) || 0;
  } catch { return 0; }
}

/** A shell line that runs `command` and writes its exit code to `codeFile` when the shell ends — however it ends: an
 *  `exit 3` of the command's own included (POSIX shells; Windows has no unit to lose it). */
function withCode(command, codeFile) {
  const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
  return `trap 'printf "%s" "$?" > ${q(codeFile).replace(/'/g, `'\\''`)}' EXIT\n${command}`;
}

module.exports = { mode, start, withCode, mainPid, _reset: () => { _mode = null; } };
