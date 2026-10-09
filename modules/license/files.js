'use strict';

/**
 * Where the licence lives: the data folder's protected keys (paths.PROTECTED_DIRS — the agent's file tools cannot read
 * or write there, and a backup carries it). Four files:
 *
 *   licence.lic          the signed licence file (Keygen's certificate), uploaded or checked out at a check-in
 *   licence.json         the licence key, when one was entered (a secret: never sent to a browser)
 *   licence-state.json   the last check-in, its outcome, and the latest time this hive has seen (clock rollback)
 *   licence-grace.json   the grace an existing install was given when licensing arrived (grace.js)
 */
const fs = require('fs');
const path = require('path');

const dir = () => path.join(require('../store').DATA_DIR, 'keys');
const at = name => path.join(dir(), name);

function readText(name) { try { return fs.readFileSync(at(name), 'utf8'); } catch { return null; } }
function readJson(name, fallback = {}) { try { return JSON.parse(fs.readFileSync(at(name), 'utf8')); } catch { return fallback; } }
function write(name, text) {
  fs.mkdirSync(dir(), { recursive: true });
  const tmp = at(`${name}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, at(name));
}
const writeJson = (name, v) => write(name, JSON.stringify(v, null, 2) + '\n');
const remove = name => { try { fs.rmSync(at(name), { force: true }); } catch { /* gone */ } };

module.exports = { dir, at, readText, readJson, write, writeJson, remove, LICENCE: 'licence.lic', CONFIG: 'licence.json', STATE: 'licence-state.json', GRACE: 'licence-grace.json' };
