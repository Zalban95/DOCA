'use strict';

/**
 * The Hugging Face token, in the hub's protected keys (audit 2026-10-06, CONSTITUTION S4): DATA_DIR/keys/
 * huggingface.json, mode 0600, in PROTECTED_FILES — no longer in the prefs file beside the settings, where every
 * backup of the settings carried it and a pack's exporter had to remember to leave it out. loadModelsPrefs() puts it
 * back into `models.hf.token` for whoever reads it and saveModelsPrefs() takes it out again, so the Models tab and
 * the services that pass it on (vLLM, the hf CLI, the guards' downloads) are unchanged. The token a file written by
 * an older DOCA still holds moves here when the server starts (migration 2.240-hf-token).
 */
const fs = require('fs');
const path = require('path');
const file = () => require('./paths').HF_KEYS_FILE;

function get() {
  try { return String(JSON.parse(fs.readFileSync(file(), 'utf8')).token || ''); } catch { return ''; }
}

function set(token) {
  token = String(token || '').trim();
  if (!token) { try { fs.rmSync(file(), { force: true }); } catch { /* none */ } return; }
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ token }, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file(), 0o600); } catch { /* Windows */ }
}

/** A token found in an older prefs file: kept here unless one is already here (the newer wins). */
function adopt(token) { if (token && !get()) set(token); }

module.exports = { get, set, adopt };
