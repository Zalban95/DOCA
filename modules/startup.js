'use strict';

/**
 * Start at boot.
 *
 * Every bit of systemd work lives in ./run.sh, and the Windows (Task Scheduler) and macOS (launchd) entries
 * in bin/doca-launch.js, so the Settings toggle and the command line stay one implementation per OS. This
 * module only reports the current state and streams the script's output back to the browser.
 */

const fs   = require('fs');
const path = require('path');
const { run, streamCmd } = require('./utils');

const SERVICE = 'openclaw-panel.service';
const SCRIPT  = path.join(__dirname, '..', 'run.sh');
const LAUNCHER = path.join(__dirname, '..', 'bin', 'doca-launch.js');
const shell = require('./shell');
const { HOME_DIR } = require('./paths');

/** Why the toggle cannot be used on this host, or null when it can. */
async function unsupportedReason() {
  // Windows and macOS start DOCA at sign-in through the Node launcher (bin/doca-launch.js): Task Scheduler and
  // launchd, no administrator needed. Linux keeps its systemd unit (run.sh).
  if (process.platform === 'win32') return shell.which('schtasks') ? null : 'schtasks not found — this Windows has no Task Scheduler CLI.';
  if (process.platform === 'darwin') return shell.which('launchctl') ? null : 'launchctl not found.';
  if (process.platform !== 'linux') return `No boot manager is known for ${process.platform}. Add DOCA to this host's own startup manager instead.`;
  try {
    const { stdout } = await run('command -v systemctl');
    if (stdout.trim()) return null;
  } catch {}
  return 'systemctl not found — this host does not use systemd, so DOCA cannot install a boot service for you.';
}

/** The launcher's own view of its boot entry, on Windows and macOS. */
function launcherState() {
  const r = require('child_process').spawnSync(process.execPath, [LAUNCHER, 'status'], { encoding: 'utf8', windowsHide: true });
  let st = {};
  try { st = JSON.parse(r.stdout); } catch {}
  return { supported: true, service: st.method === 'launchd' ? require(LAUNCHER).LABEL : require(LAUNCHER).TASK, method: st.method,
    enabled: !!st.ok, active: true, supervised: false };
}

async function state() {
  const reason = await unsupportedReason();
  if (reason) return { supported: false, reason, service: SERVICE, enabled: false, active: false };
  if (process.platform !== 'linux') return launcherState();

  // Both exit non-zero for "no" (and for a unit that was never installed),
  // which run() turns into a rejection — absence is an answer here, not a fault.
  const ask = async cmd => {
    try { return (await run(cmd)).stdout.trim(); } catch (e) { return (e.stdout || '').trim(); }
  };
  const [enabled, active, unitDir] = await Promise.all([
    ask(`systemctl is-enabled ${SERVICE}`),
    ask(`systemctl is-active ${SERVICE}`),
    ask(`systemctl show -p WorkingDirectory --value ${SERVICE}`),
  ]);
  // The unit's name is fixed, so a second DOCA on this machine (a trial install beside the one in use) found the
  // first one's unit and called it its own — and its toggle would have switched the other one's boot off.
  const elsewhere = otherInstall(unitDir);
  if (elsewhere) return { supported: true, service: SERVICE, enabled: false, active: false, elsewhere };

  return {
    supported: true,
    service: SERVICE,
    enabled: enabled === 'enabled',
    active:  active  === 'active',
    // systemd sets this on the unit it started: the panel answering right now
    // *is* the service, rather than something started by hand.
    supervised: !!process.env.INVOCATION_ID,
  };
}

/** The folder of the DOCA the boot unit starts, when it is not this one; null when it is this one or there is none. */
function otherInstall(unitDir, home = HOME_DIR) {
  if (!unitDir) return null;
  const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  return real(unitDir) === real(home) ? null : unitDir;
}

/** GET /api/startup */
async function handleStatus(_req, res) {
  try {
    res.json(await state());
  } catch (e) {
    res.status(500).json({ error: e.error || e.message || String(e) });
  }
}

/** POST /api/startup — body { enabled, password }. Streams run.sh as SSE. */
async function handleSet(req, res) {
  const reason = await unsupportedReason();
  if (reason) return res.status(400).json({ error: reason });

  const verb = req.body?.enabled ? 'enable' : 'disable';
  if (process.platform === 'linux') return streamCmd(res, `bash '${SCRIPT}' ${verb}`, { password: req.body?.password });
  // PowerShell needs the call operator before a quoted path; a POSIX shell does not.
  const cmd = `"${process.execPath}" "${LAUNCHER}" ${verb}`;
  streamCmd(res, process.platform === 'win32' ? `& ${cmd}` : cmd);
}

module.exports = { SERVICE, state, handleStatus, handleSet, otherInstall };
