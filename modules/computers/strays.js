'use strict';

/**
 * Computer containers no record names (self-test 2026-10-08, #25): a `docker run` that made the container and then
 * failed to start it threw before the record was saved, so the container sat in "created" for days, in no list.
 *
 * The tidy-up removes, with a line in the activity log:
 * - a container that never started ("created") and is over an hour old, whoever made it — it never ran, so nothing
 *   is in it, and its volume goes with it;
 * - a stopped one this install made (its `doca.install` label, since this change) that no record names — its
 *   volume is kept, since an agent's files may be in it, and the line names it.
 * A running container is never touched, and neither is a stopped one without this install's label: several DOCAs
 * (a test run, a second install) may share one Docker, and theirs are theirs.
 */
const crypto = require('crypto');
const { execFile } = require('child_process');

const NEVER_STARTED_AFTER_MS = 3600000;

/** This install, as the label its computers carry: its data folder, hashed. */
const installId = () => crypto.createHash('sha256').update(require('../store').DATA_DIR).digest('hex').slice(0, 12);

const run = args => new Promise((resolve, reject) => execFile(require('../containers').cli(), args,
  { timeout: 60000, maxBuffer: 8 << 20, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(String(out)))));

/** Docker's "2026-10-07 16:34:24 +0200 CEST", which Date cannot read. */
function createdAt(s) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})/.exec(String(s || ''));
  return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : NaN;
}

async function sweep({ now = Date.now(), docker = run } = {}) {
  let out;
  try { out = await docker(['ps', '-a', '--filter', 'label=doca.computer=1', '--format', '{{.Names}}\t{{.State}}\t{{.CreatedAt}}\t{{.Label "doca.install"}}']); }
  catch { return []; }   // no docker here
  const known = new Set(require('./index').all().map(c => `doca-computer-${c.id}`));
  const gone = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const [name, state, created, install] = line.split('\t');
    if (!/^doca-computer-[\w-]+$/.test(name) || known.has(name)) continue;
    const neverStarted = state === 'created' && now - createdAt(created) > NEVER_STARTED_AFTER_MS;
    const oursStopped = install === installId() && state !== 'running' && state !== 'created' && state !== 'restarting';
    if (!neverStarted && !oursStopped) continue;
    try { await docker(['rm', '-f', name]); } catch { continue; }
    if (neverStarted) await docker(['volume', 'rm', '-f', name]).catch(() => {});
    gone.push(name);
    require('../activity').note({ from: 'computers', what: `removed the container ${name}, which no computer of this panel names`,
      why: neverStarted ? 'it was made but never started (a computer that failed to start), over an hour ago'
        : `it was stopped and its record is gone; its files are kept in the volume ${name}` });
  }
  return gone;
}

module.exports = { sweep, installId, createdAt };
