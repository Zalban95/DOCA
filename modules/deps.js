'use strict';

/**
 * The panel's own dependencies: which are behind, and which have advisories.
 *
 * An update installs the new version's package-lock.json, so a dependency
 * moves only when a release moves it — and nothing said when one was stale.
 * This runs `npm outdated` and `npm audit` for the version that is running
 * (its own folder, which is what its node_modules belong to), with each
 * package's licence from what is installed. Both ask the npm registry, so the
 * answer is kept for an hour and asked again only on request.
 *
 * Updating stays a release step, not a button: `npm run deps:update` updates
 * within the declared ranges and runs the tests, and the lock file ships with
 * the next version. Auth depends on `hash-wasm`; this is how it stays current
 * by habit rather than memory.
 */
const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TTL = 3600e3;
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let _cache = null;   // { at, result }

/** npm, with its JSON on stdout — both commands exit 1 when they found something. */
let npmJson = function npmJson(args, { cwd = ROOT, timeout = 90000 } = {}) {
  return new Promise(resolve => {
    execFile(NPM, [...args, '--json'], { cwd, timeout, maxBuffer: 16 << 20, windowsHide: true }, (err, stdout) => {
      try { resolve({ json: JSON.parse(stdout || '{}') }); }
      catch { resolve({ error: err?.killed ? 'npm did not answer in time' : (err?.message || 'npm gave no answer').split('\n')[0] }); }
    });
  });
};
/** Tests answer for npm; nothing else should. */
function _setNpm(fn) { npmJson = fn; _cache = null; }

function licenceOf(name, cwd = ROOT) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules', name, 'package.json'), 'utf8'));
    return typeof pkg.license === 'string' ? pkg.license : pkg.license?.type || null;
  } catch { return null; }
}

/** Turn the two npm answers into one list a person reads. */
function shape(outdated, audit, cwd = ROOT) {
  const own = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  const direct = { ...own.dependencies, ...own.devDependencies };
  const packages = Object.entries(outdated || {}).map(([name, o]) => ({
    name, current: o.current || null, wanted: o.wanted || null, latest: o.latest || null,
    declared: direct[name] || null, licence: licenceOf(name, cwd),
    // Wanted is what the declared range allows; latest past it needs a range change, i.e. a decision.
    inRange: !!o.current && o.current !== o.wanted,
    major: !!o.latest && !!o.wanted && o.latest.split('.')[0] !== o.wanted.split('.')[0],
  })).sort((a, b) => a.name.localeCompare(b.name));
  const advisories = Object.entries(audit?.vulnerabilities || {}).map(([name, v]) => {
    const via = (v.via || []).find(x => typeof x === 'object') || {};
    return { name, severity: v.severity, direct: !!v.isDirect, title: via.title || null, url: via.url || null,
      fixInRange: v.fixAvailable === true };
  }).sort((a, b) => SEV.indexOf(b.severity) - SEV.indexOf(a.severity) || a.name.localeCompare(b.name));
  return { packages, advisories, counts: audit?.metadata?.vulnerabilities || null };
}
const SEV = ['info', 'low', 'moderate', 'high', 'critical'];

/** { packages, advisories, counts, checkedAt, errors } — cached for an hour unless `force`. */
async function check({ force = false, cwd = ROOT } = {}) {
  if (!force && _cache && Date.now() - _cache.at < TTL) return _cache.result;
  const [o, a] = await Promise.all([npmJson(['outdated'], { cwd }), npmJson(['audit'], { cwd })]);
  const result = {
    ...shape(o.json, a.json, cwd),
    checkedAt: new Date().toISOString(),
    errors: [o.error && `npm outdated: ${o.error}`, a.error && `npm audit: ${a.error}`].filter(Boolean),
  };
  _cache = { at: Date.now(), result };
  return result;
}

function handleDeps(req, res) {
  check({ force: req.query.force === '1' })
    .then(r => res.json(r))
    .catch(e => res.status(500).json({ error: e.message }));
}

module.exports = { check, shape, handleDeps, _setNpm };
