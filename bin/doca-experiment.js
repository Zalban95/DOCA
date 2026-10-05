#!/usr/bin/env node
'use strict';

/**
 * Measure an experiment (docs/design/hive.md §8): `npm run experiment -- <id>`, each measured by bin/experiments/<id>.js.
 *
 * Runs on a throwaway copy of this machine's settings and model keys (a temp data folder; the real one is never
 * written), with the experiment switched on there, against the models this machine is configured with — a paid
 * provider's tokens are real, which is why nothing runs it by itself. Prints a row for the write-up's results table.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const which = process.argv[2];
const known = fs.readdirSync(path.join(__dirname, 'experiments')).map(f => f.replace(/\.js$/, ''));
if (!known.includes(which)) { console.error(`usage: npm run experiment -- ${known.join(' | ')}`); process.exit(2); }

// A copy of the real settings and keys, before any module reads its paths.
const real = require('../modules/paths');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-experiment-'));
fs.mkdirSync(path.join(tmp, 'data', 'keys'), { recursive: true });
try { fs.copyFileSync(process.env.DOCA_PREFS_FILE || path.join(real.HOME_DIR, '.dashboard-prefs.json'), path.join(tmp, 'prefs.json')); } catch { fs.writeFileSync(path.join(tmp, 'prefs.json'), '{}'); }
try { fs.copyFileSync(real.PROVIDER_KEYS_FILE, path.join(tmp, 'data', 'keys', 'providers.json')); } catch { /* keys may live in openclaw.json */ }
for (const k of Object.keys(require.cache)) delete require.cache[k];
Object.assign(process.env, { DOCA_DATA_DIR: path.join(tmp, 'data'), DOCA_PREFS_FILE: path.join(tmp, 'prefs.json'), DOCA_HOME: tmp, WORKSPACE_DIR: tmp, ATTACHMENTS_DIR: path.join(tmp, 'attachments') });

const main = () => require(`./experiments/${which}`).measure({ tmp });

main().then(code => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(code); })
  .catch(e => { console.error(`experiment: ${e.message}`); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
