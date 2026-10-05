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
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  Object.assign(process.env, { DOCA_DATA_DIR: path.join(tmp, 'data'), DOCA_PREFS_FILE: path.join(tmp, 'prefs.json'), DOCA_HOME: tmp, WORKSPACE_DIR: tmp, ATTACHMENTS_DIR: path.join(tmp, 'attachments') });
  return { tmp, realDataDir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

module.exports = { sandbox };
