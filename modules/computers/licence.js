'use strict';

/**
 * A licence for the DOCA installed inside an agents' computer (asked 2026-10-14; license/pool.js keeps the seats).
 * The hub reads the inner hive's fingerprint itself through `docker exec` — its own id (keys/hive-id in the inner data
 * folder, made here when the inner hive has not made one yet) and the container's machine id, the formula of
 * license/fingerprint.js — or takes the one the agent read from the inner panel; asks the pool for a seat; and copies
 * the machine file into the inner install's keys/licence.lic with `docker cp`. The inner hive reads it at its next
 * start. The computer never calls the licence server, and nothing here writes the pool's key on its own.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA = '/home/agent/doca/.doca';   // where scripts/install.sh puts the data folder (~/doca/.doca) for the agent user
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

function dataDir(p) {
  const d = String(p || DATA).trim();
  if (!d.startsWith('/') || d.split('/').includes('..')) throw bad('The inner install\'s data folder is an absolute path inside the computer, e.g. /home/agent/doca/.doca.');
  return d.replace(/\/+$/, '');
}

/** The inner hive's fingerprint, read in the computer. → {fingerprint, made} — `made` when its hive id was made here. */
async function readFingerprint(c, dir) {
  const computers = require('./index');
  // Mirrors fingerprint.js: /etc/machine-id, then dbus's, else "host:<hostname>"; the hive id is 32 hex characters.
  const script = 'd="$1"; f="$d/keys/hive-id"; '
    + 'if [ ! -s "$f" ]; then mkdir -p "$d/keys" && printf "%s\\n" "$2" > "$f" && chmod 600 "$f" && echo MADE=1; fi; '
    + 'echo "HIVE=$(cat "$f")"; m=$(cat /etc/machine-id 2>/dev/null); [ -z "$m" ] && m=$(cat /var/lib/dbus/machine-id 2>/dev/null); '
    + 'echo "MACHINE=$m"; echo "HOST=$(hostname)"';
  const out = await computers.docker(['exec', computers.container(c), 'sh', '-c', script, 'sh', dir, crypto.randomBytes(16).toString('hex')]);
  const v = k => ((new RegExp(`^${k}=(.*)$`, 'm').exec(out) || [])[1] || '').trim();
  if (!/^[0-9a-f]{32}$/.test(v('HIVE'))) throw bad(`The inner hive's id in ${dir}/keys/hive-id is not one the hive made: pass its fingerprint (its Settings → System → Licence shows it).`, 409);
  const machine = v('MACHINE') || `host:${v('HOST')}`;
  return { fingerprint: require('../license/fingerprint').of(v('HIVE'), machine), made: out.includes('MADE=1') };
}

/** Copy the file into <dir>/keys/licence.lic, the agent's own and readable by it alone. */
async function install(c, dir, certificate) {
  const computers = require('./index');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-lic-'));
  try {
    const local = path.join(tmp, 'licence.lic');
    fs.writeFileSync(local, certificate.trim() + '\n', { mode: 0o600 });
    await computers.docker(['exec', computers.container(c), 'mkdir', '-p', `${dir}/keys`]);
    await computers.docker(['cp', local, `${computers.container(c)}:${dir}/keys/licence.lic`]);
    await computers.docker(['exec', '-u', '0', computers.container(c), 'sh', '-c', 'chown agent:agent "$1" && chmod 600 "$1"', 'sh', `${dir}/keys/licence.lic`]).catch(() => {});
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return `${dir}/keys/licence.lic`;
}

/** The `computer` tool's `licence`: a seat for the computer's inner hive, its file in place. → a sentence */
async function give(id, { fingerprint, path: dir } = {}) {
  const c = require('./index').need(id);
  dir = dataDir(dir);
  require('../license/pool').ready();   // no pool: said before anything is made in the computer
  let fp = String(fingerprint || '').trim().toLowerCase(), made = false;
  if (!fp) ({ fingerprint: fp, made } = await readFingerprint(c, dir));
  const r = await require('../license/pool').grant({ computer: c.id, name: c.name, fingerprint: fp });
  const at = await install(c, dir, r.certificate);
  const what = r.terms.codes.length ? r.terms.codes.join(', ') : 'the core';
  return `A test licence is in ${at} (${r.terms.edition || 'its edition'}: ${what}${r.terms.fileExpiry ? `; the file is good until ${String(r.terms.fileExpiry).slice(0, 10)}` : ''}), `
    + `for the hive with fingerprint ${fp.slice(0, 12)}…${made ? ' (its id was made now: it had not made one yet)' : ''}. Seat ${r.seat.used} of ${r.seat.of} of the licence for test computers. `
    + `The ${require('../branding').name('product')} in it reads its licence when it starts: restart it (or start it) for the licensed features to be there. Removing or archiving this computer gives the seat back.`;
}

/** Give the seat back; never in the way of removing or archiving the computer. */
async function release(id, reason) {
  try { return await require('../license/pool').release(id, { reason }); } catch { return null; }
}

module.exports = { give, release, readFingerprint, dataDir, DATA };
