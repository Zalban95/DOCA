'use strict';

/**
 * A throwaway copy of this machine's settings and model keys, for a measurement that must not touch the real data:
 * the prefs file and keys/providers.json copied into a temp folder, the data folder, workspace and attachments
 * pointed there, and every module forgotten so they read their paths again. Call before requiring anything that
 * reads a path. `realDataDir` is where the real data folder is, for results that should outlive the sandbox.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function sandbox(prefix = 'doca-sandbox-') {
  const real = require('../../modules/paths');
  const realDataDir = require('../../modules/store').DATA_DIR;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(tmp, 'data', 'keys'), { recursive: true });
  try { fs.copyFileSync(process.env.DOCA_PREFS_FILE || path.join(real.HOME_DIR, '.dashboard-prefs.json'), path.join(tmp, 'prefs.json')); } catch { fs.writeFileSync(path.join(tmp, 'prefs.json'), '{}'); }
  try { fs.copyFileSync(real.PROVIDER_KEYS_FILE, path.join(tmp, 'data', 'keys', 'providers.json')); } catch { /* keys may live in openclaw.json */ }
  // The licence (and its grace), so the measurement holds the tools and features this hive has: without it the
  // copy ran `core` alone — eleven fewer tools than the hive it measured, and no experiment could turn on (2026-10-09).
  // Copied as files, never read here.
  for (const f of ['licence.lic', 'licence.json', 'licence-state.json', 'licence-grace.json'])
    try { fs.copyFileSync(path.join(realDataDir, 'keys', f), path.join(tmp, 'data', 'keys', f)); } catch { /* none of that kind */ }
  // No MCP server a person's device hosts: a measurement must not reach the real phone or desk (an eval case read the
  // owner's phone through mcp_connect, 2026-10-07). Servers on this machine stay — measuring is what they are for here.
  try {
    const f = path.join(tmp, 'prefs.json'), prefs = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Array.isArray(prefs.mcpServers)) {   // a list (mcp/registry.js); a delete would leave nulls every turn trips on
      prefs.mcpServers = prefs.mcpServers.filter(d => d?.origin?.kind !== 'client');
      fs.writeFileSync(f, JSON.stringify(prefs, null, 2));
    }
  } catch { /* prefs that do not parse are the measurement's problem, not this one's */ }
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  Object.assign(process.env, { DOCA_DATA_DIR: path.join(tmp, 'data'), DOCA_PREFS_FILE: path.join(tmp, 'prefs.json'), DOCA_HOME: tmp, WORKSPACE_DIR: tmp, ATTACHMENTS_DIR: path.join(tmp, 'attachments') });
  // Retried, and never fatal: on Windows a file the run still holds open (its database) refuses to go for a moment,
  // and a throw here turned a passing run's exit code into 1 (CI, 2026-10-07). A leftover temp folder is the OS's to clear.
  const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left in the temp folder */ } };
  return { tmp, realDataDir, cleanup };
}

module.exports = { sandbox };
