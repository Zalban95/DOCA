'use strict';

/**
 * Start at boot.
 *
 * Every bit of systemd work lives in ./run.sh, so the Settings toggle and the
 * command line stay one implementation. This module only reports the current
 * state and streams the script's output back to the browser.
 */

const path = require('path');
const { run, streamCmd } = require('./utils');

const SERVICE = 'openclaw-panel.service';
const SCRIPT  = path.join(__dirname, '..', 'run.sh');

/** Why the toggle cannot be used on this host, or null when it can. */
async function unsupportedReason() {
  if (process.platform !== 'linux') {
    return `Start at boot installs a systemd service, which ${process.platform} does not have. Add DOCA to this host's own startup manager instead.`;
  }
  try {
    const { stdout } = await run('command -v systemctl');
    if (stdout.trim()) return null;
  } catch {}
  return 'systemctl not found — this host does not use systemd, so DOCA cannot install a boot service for you.';
}

async function state() {
  const reason = await unsupportedReason();
  if (reason) return { supported: false, reason, service: SERVICE, enabled: false, active: false };

  // Both exit non-zero for "no" (and for a unit that was never installed),
  // which run() turns into a rejection — absence is an answer here, not a fault.
  const ask = async cmd => {
    try { return (await run(cmd)).stdout.trim(); } catch (e) { return (e.stdout || '').trim(); }
  };
  const [enabled, active] = await Promise.all([
    ask(`systemctl is-enabled ${SERVICE}`),
    ask(`systemctl is-active ${SERVICE}`),
  ]);

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
  streamCmd(res, `bash '${SCRIPT}' ${verb}`, { password: req.body?.password });
}

module.exports = { SERVICE, state, handleStatus, handleSet };
