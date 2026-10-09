'use strict';

/**
 * Development or production (docs/design/production.md; the owner's rule of 2026-10-09, proposed as CONSTITUTION S15):
 * "We can work on the repo without many safeguards on our machine, but the safeties always apply in the versions in
 * production and the demo sandboxes."
 *
 *   development   the hive's licence carries the lab (`lab`, or `all` — the owner edition, a tester's) and it is not
 *                 a hosted hive: its admin and their agents may change DOCA from within, as they always could
 *   production    everything else — a customer's hive (on our servers or theirs), a demo or beta sandbox, a hive with
 *                 no licence: every safety applies to everyone, its admin included. Nobody and no agent changes DOCA
 *                 itself, its charter or its guards; what a person makes (projects, the workspace) works as ever
 *
 * Decided structurally, never a setting: from the licence in effect at start (license.boot()) and the hosted profile
 * (hosted.js, from the environment). Read once, at the first question, and kept until the next start — like the licence.
 *
 * What production takes away is here, in one place: the code's folders out of reach of every file tool and route
 * (`inCode`, `holdsCode`), the routes that change DOCA itself (`ROUTES`), the lab (license/index.js `has`), and the
 * licence's seat and device limits (license/limits.js), which apply in production only. test/edition-mode.test.js.
 */
const fs = require('fs');
const path = require('path');

let _mode = null;

function decide() {
  const hosted = require('./hosted').on();
  let lab = false;
  try { const b = require('./license').boot(); lab = !!b.all || (b.codes || []).includes('lab'); } catch { /* no licence readable */ }
  if (hosted) return { mode: 'production', why: 'a hosted hive is always production (DOCA_PROFILE=hosted)' };
  if (lab) return { mode: 'development', why: 'its licence carries the lab (the owner edition, a tester\'s)' };
  return { mode: 'production', why: 'its licence does not carry the lab' };
}

/** {mode, why}, read once. */
function state() { return _mode || (_mode = decide()); }
const mode = () => state().mode;
const production = () => mode() === 'production';
const development = () => mode() === 'development';

/** The one line the agent's environment carries (stable for the life of the process). */
function line() {
  return production()
    ? 'hive: production — DOCA itself (its code, charter, guards and shipped definitions) is not changed or read from inside; work in projects, the workspace and on devices'
    : 'hive: development — the owner\'s: DOCA may be debugged and changed from within';
}

/* ── The code's folders ───────────────────────────────── */

const real = p => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const fold = s => (process.platform === 'win32' ? s.toLowerCase() : s);
const under = (p, dir) => { const a = fold(p), d = fold(dir); return a === d || a.startsWith(d.endsWith(path.sep) ? d : d + path.sep); };

let _dirs = null;
/** Where DOCA's code is (the running version and the install holding its other versions), and what in there is data. */
function dirs() {
  if (_dirs) return _dirs;
  const app = real(path.join(__dirname, '..'));
  const home = real(process.env.DOCA_HOME || app);
  // DOCA_HOME is the install (a checkout, holding the other versions in .releases) — or, in the image, the data volume:
  // it is code only where it holds DOCA's own server.
  const code = [...new Set([app, ...(fs.existsSync(path.join(home, 'server.js')) ? [home] : []), path.join(home, '.releases')])];
  // An install made by scripts/install.* keeps its data beside its code by default (.doca, prefs, backups): those are
  // the hive's, not DOCA's, and stay where they were reachable before.
  const p = require('./paths');
  const prefs = real(p.PREFS_FILE);
  const data = [real(require('./store').DATA_DIR), real(p.BACKUP_DIR), prefs, `${prefs}.bak`];
  _dirs = { code, data };
  return _dirs;
}

/** Whether a real path is DOCA's code (in production): inside a code folder, and not the hive's data kept there. */
function inCode(p) {
  if (!p || !production()) return false;
  const r = real(p), { code, data } = dirs();
  return code.some(c => under(r, c)) && !data.some(d => under(r, d));
}

/** Whether a folder holds DOCA's code (a walk from it would reach the code): `/`, the home folder of an install. */
function holdsCode(p) {
  if (!p || !production()) return false;
  const r = real(p);
  return dirs().code.some(c => under(c, r) && c !== r) || inCode(r);
}

const SAY = 'This hive is in production: DOCA\'s own code is not part of it — nobody, and no agent, reads or changes it '
  + 'from inside. Work in a project, the workspace or on a device.';

/** The sentence a file tool says for a path in the code. */
function refusal(p) { return `${p} is DOCA's own code. ${SAY}`; }

/**
 * A shell line on a production hive that names the code's folder, or runs in it: refused with the same sentence.
 * A speed bump, not a wall — a command can reach any path it can spell another way; the hosted profile (no shell at
 * all) is the wall. Said as such in docs/design/production.md.
 */
function shellRefusal(command, cwd) {
  if (!production()) return null;
  if (cwd && inCode(cwd)) return refusal(cwd);
  const text = String(command || '');
  const hit = dirs().code.find(c => text.includes(c));
  return hit ? refusal(hit) : null;
}

/* ── What production does not have ───────────────────── */

// [method or '*', path pattern]: answered as absent (hosted.middleware asks this too). The code's own life: updating it
// from git, its packages, promoting a specialist into the repository. Versions stay — production switches only between
// signed releases the update channel installed (releases.js refusal), which is the way back (P17).
const ROUTES = [
  ['POST', /^\/api\/update$/],
  ['*', /^\/api\/deps$/],
  ['POST', /^\/api\/harness\/agents\/[^/]+\/promote$/],
];
const absentRoute = (method, p) => production() && ROUTES.some(([m, re]) => (m === '*' || m === method) && re.test(p));

/** Tests: decide again (as a restart would). */
function reload() { _mode = null; _dirs = null; }

module.exports = { mode, state, production, development, line, inCode, holdsCode, refusal, shellRefusal, ROUTES, absentRoute, SAY, reload };
