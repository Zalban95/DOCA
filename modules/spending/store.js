'use strict';

/**
 * Where the spending rules are kept (docs/design/spending.md): budgets per person and per level, what each level may
 * allow, and the spending permissions — one file, `DATA_DIR/keys/spending.json`, mode 0600.
 *
 * In the keys folder on purpose: that folder is protected from the agent's file tools (paths.PROTECTED_DIRS), and a
 * record of what the agent may spend is exactly what it must not be able to write itself. Every change goes through
 * this module's callers, whose routes ask for the password (auth/guarded.js).
 */
const fs   = require('fs');
const path = require('path');

const file = () => path.join(path.dirname(require('../paths').SERVICE_KEYS_FILE), 'spending.json');

/** { people: { <userId>: { own?, budget? } }, levels: { <levelId>: { budget?, mayAllow? } }, permissions: [] } */
function load() {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(file(), 'utf8')) || {}; } catch { /* none yet: nothing is limited, nothing allowed */ }
  return { people: d.people || {}, levels: d.levels || {}, permissions: Array.isArray(d.permissions) ? d.permissions : [] };
}

function save(d) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(d, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file(), 0o600); } catch { /* Windows */ }
}

/** Read, change, write: `fn(d)` mutates and may return a result. */
function change(fn) {
  const d = load();
  const out = fn(d);
  save(d);
  return out;
}

module.exports = { file, load, save, change };
