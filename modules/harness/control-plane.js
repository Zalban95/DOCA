'use strict';

/**
 * The files that govern the agent, which the agent's own write tools refuse.
 *
 * The panel's rule is that the agent proposes and a person decides (AGENTS.md,
 * ISSUES.md H-19): settings go through settings_propose, and a click applies
 * them. write_file used to have no such check — only its approval prompt stood
 * between the agent and the prefs file, and in Auto mode or with an
 * "always allow" rule that prompt is not there (audit 2026-09-26, N2). So the
 * write tools (write_file, replace_in_files) refuse these, whatever the
 * approval mode:
 *   - the panel's settings (the prefs file, which holds the approval mode itself)
 *   - OpenClaw's config and DOCA's provider keys
 *   - accounts and sessions (auth/), devices and their scopes, the backup schedule
 *   - the release pointer the launcher reads (.releases/current, pending) and .env
 *   - service units (systemd), user or system
 * Reading them stays allowed. `shell` runs as the same user and could still
 * write them: that is the stated limit of one account on one machine, and why
 * shell is a danger tool.
 */
const path = require('path');
const os   = require('os');
const paths = require('../paths');

function dataDir() { return require('../store').DATA_DIR; }

/** Files and folders, absolute. A folder covers everything under it. */
function entries() {
  const home = paths.HOME_DIR;
  return [
    { at: paths.PREFS_FILE, what: 'the panel\'s settings' },
    { at: paths.CONFIG_PATH, what: 'OpenClaw\'s config' },
    { at: paths.PROVIDER_KEYS_FILE, what: 'the provider keys' },
    { at: path.join(home, '.env'), what: 'the panel\'s environment' },
    { at: path.join(home, '.releases', 'current'), what: 'the version the launcher starts' },
    { at: path.join(home, '.releases', 'pending'), what: 'the version switch in progress' },
    { at: path.join(dataDir(), 'auth'), dir: true, what: 'accounts and sessions' },
    { at: path.join(dataDir(), 'devices.json'), what: 'paired devices and their scopes' },
    { at: path.join(dataDir(), 'keys'), dir: true, what: 'the provider keys' },
    { at: path.join(dataDir(), 'backup'), dir: true, what: 'the backup schedule' },
    { at: path.join(os.homedir(), '.config', 'systemd'), dir: true, what: 'service units' },
    { at: '/etc/systemd', dir: true, what: 'service units' },
  ];
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

/** What `abs` is, when it is part of the control plane; else null. By its real path too. */
function which(abs) {
  const cands = [path.resolve(abs)];
  try { cands.push(require('fs').realpathSync(abs)); } catch { /* a new file */ }
  for (const p of cands) {
    for (const e of entries()) {
      const at = path.resolve(e.at);
      if (same(p, at) || (e.dir && (p.startsWith(at + path.sep)))) return e.what;
    }
  }
  return null;
}

/** Throw the refusal the agent reads, when `abs` is part of the control plane. */
function refuse(abs) {
  const what = which(abs);
  if (what) throw new Error(`${abs} is ${what} — part of what governs this agent, which its own tools do not write. `
    + 'Propose the change instead (settings_propose), or tell the owner what to change; a person decides.');
}

module.exports = { which, refuse, entries };
