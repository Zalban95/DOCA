'use strict';

/**
 * What will bring DOCA back after it exits — asked by every restart (Restart, a version switch, a restore), so that
 * none of them is a kill switch.
 *
 * Deep test B (2026-10-08) found one: any `/.dockerenv` was taken as "a restart policy will start us again". That is
 * only true when this node *is* the container's main process — PID 1, or the one child of an init shim (tini,
 * dumb-init, docker's --init) that exits with it. In an agents' computer (PID 1 is the computer's own control server),
 * a dev container or behind a shell entrypoint, nothing restarts it: the panel went down and stayed down. Likewise
 * INVOCATION_ID is set for every process under any systemd unit — a desktop terminal included — and a unit restarts a
 * process that exited cleanly only with Restart=always or on-success.
 *
 * So a supervisor is named only when it really will start us again; otherwise the caller hands off to a detached
 * successor (the launcher, modules/relaunch.js), or — where a detached successor would be killed with us, a systemd
 * unit that does not restart — refuses with a sentence saying how to restart it instead.
 */
const fs = require('fs');
const { spawnSync } = require('child_process');

// Inits that only pass signals on and exit with their one child, so the container ends with us. (supervisord, runit
// and s6 are left out: whether they restart a clean exit is their own configuration.)
const SHIMS = /^(tini|dumb-init|docker-init|catatonit)$/;

function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } }

/** The systemd service this process runs in — the leaf of its cgroup path (`…/openclaw-panel.service`) — and
 *  whether it is a user unit; null in a scope (a desktop terminal's shell) or outside systemd. */
function unitOf(cgroup) {
  if (!cgroup) return null;
  const line = cgroup.split('\n').find(l => l.startsWith('0::')) || cgroup.split('\n')[0];
  const parts = line.replace(/^[^:]*:[^:]*:/, '').split('/').filter(Boolean);
  const leaf = parts[parts.length - 1];
  if (!leaf || !leaf.endsWith('.service') || /^user@\d+\.service$/.test(leaf)) return null;
  return { unit: leaf, user: parts.some(p => /^user@\d+\.service$/.test(p)) };
}

/** systemd's Restart= and MainPID for a unit, or null when systemctl cannot say. */
function unitState({ unit, user }, run = spawnSync) {
  try {
    const r = run('systemctl', [...(user ? ['--user'] : []), 'show', '-p', 'Restart', '-p', 'MainPID', unit], { encoding: 'utf8', timeout: 3000 });
    if (r.status !== 0) return null;
    const v = Object.fromEntries(String(r.stdout || '').trim().split('\n').map(l => l.split('=')).filter(a => a.length === 2));
    return v.Restart ? { restart: v.Restart, mainPid: Number(v.MainPID) || 0 } : null;
  } catch { return null; }
}

/**
 * What will start this process again after a clean exit: `{name}` (exit and let it), `{refuse}` (nothing will, and a
 * successor cannot outlive us here: a sentence), or `{name: null}` (on our own: hand off to a successor).
 * Every input can be given, so the tests stand in any machine.
 */
function decide({ env = process.env, pid = process.pid, ppid = process.ppid, read = readText, exists = fs.existsSync, state = unitState } = {}) {
  if (env.DOCA_SUPERVISOR) return { name: env.DOCA_SUPERVISOR };          // an operator who knows says so
  if (env.pm_id) return { name: 'pm2' };                                   // pm2 restarts by default
  if (env.INVOCATION_ID) {
    const u = unitOf(read('/proc/self/cgroup'));
    const st = u && state(u);
    // Only the unit's main process (us, or the launcher that started us) is restarted by it; a process that merely
    // runs inside some unit (a terminal service's shell) is on its own, and a successor it starts outlives it.
    const ours = st && (st.mainPid === pid || st.mainPid === ppid);
    if (u && st && ours) {
      if (st.restart === 'always' || st.restart === 'on-success') return { name: 'systemd', unit: u.unit };
      return { refuse: `DOCA runs as the systemd unit ${u.unit}, which does not start it again after it stops (Restart=${st.restart}), and a process DOCA started would be stopped with it. Restart it there instead: systemctl ${u.user ? '--user ' : ''}restart ${u.unit}` };
    }
    // systemctl could not say: DOCA's own unit (run.sh writes Restart=always) is still trusted by its name.
    if (u && !st && u.unit === 'openclaw-panel.service') return { name: 'systemd', unit: u.unit };
    // INVOCATION_ID without a unit we can name: inherited from a desktop session, not a supervisor.
  }
  let inContainer = false;
  try { inContainer = exists('/.dockerenv') || exists('/run/.containerenv'); } catch {}
  if (inContainer) {
    if (pid === 1) return { name: 'container' };
    const init = (read('/proc/1/comm') || '').trim();
    if (ppid === 1 && SHIMS.test(init)) return { name: 'container' };
  }
  return { name: null };
}

/** The old shape, kept for its callers: the supervisor's name, or null when DOCA must hand off itself. */
function supervisorName(opts) { return decide(opts).name || null; }

module.exports = { decide, supervisorName, unitOf, unitState, SHIMS };
