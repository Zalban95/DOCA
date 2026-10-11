'use strict';

/**
 * Mounting and unmounting a disk the way the desktop would (asked 2026-10-12).
 *   1. udisks, as the person running DOCA: `udisksctl mount -b <dev> --no-user-interaction` — it mounts under
 *      /media/<user>/<label>, owned by that user, and is what a file manager does. `--no-user-interaction`, because
 *      without a desktop session polkit would otherwise wait for an answer nobody can give.
 *   2. When polkit says no (a hub without a desktop session), the panel's sudo path (utils.streamCmd with the password
 *      the person types): a folder /media/<user>/<label>, mounted nosuid,nodev, and for NTFS, exFAT and FAT — which
 *      have no owners of their own — the user's uid and gid, so the files are theirs as udisks would make them.
 * Only a device that is in the current list, and allowed there (list.js), is ever acted on; every command is argv
 * (udisks) or built from quoted values (sudo). The runner is replaceable, so a test never touches a disk.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const list = require('./list');

const OWNERLESS = new Set(['ntfs', 'ntfs3', 'ntfs-3g', 'exfat', 'vfat', 'fat', 'msdos']);
const DENIED = /not ?authori[sz]ed|NotAuthorized|authentication is required|polkit/i;

/** run(cmd, args) → {code, stdout, stderr}. Replaced in tests. */
let runner = (cmd, args) => new Promise(resolve => {
  execFile(cmd, args, { timeout: 30000, env: { ...process.env, LC_ALL: 'C' }, windowsHide: true }, (err, stdout, stderr) =>
    resolve({ code: err ? (err.code === 'ENOENT' ? 127 : typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || err?.message || '') }));
});

const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

function who() {
  const u = os.userInfo();
  return { user: u.username, uid: typeof process.getuid === 'function' ? process.getuid() : u.uid, gid: typeof process.getgid === 'function' ? process.getgid() : u.gid };
}

/** Where the sudo path mounts it: /media/<user>/<label>, or <label>-<name> when that folder is taken. */
function folderFor(d, { user, mediaRoot = '/media', exists = p => fs.existsSync(p), empty = p => { try { return !fs.readdirSync(p).length; } catch { return true; } } } = {}) {
  const base = path.posix.join(mediaRoot, user, list.folderName(d));
  if (!exists(base) || empty(base)) return base;
  return `${base}-${d.name}`;
}

/** The commands a mount would run, without running them. */
function mountPlan(d, opts = {}) {
  const me = { ...who(), ...opts };
  const dir = folderFor(d, me);
  const o = ['nosuid', 'nodev'];
  if (OWNERLESS.has(String(d.fstype || '').toLowerCase())) o.push(`uid=${me.uid}`, `gid=${me.gid}`, 'umask=022');
  return {
    udisks: ['udisksctl', ['mount', '-b', d.path, '--no-user-interaction']],
    sudo: `sudo mkdir -p ${q(dir)} && sudo mount -o ${o.join(',')} ${q(d.path)} ${q(dir)}`,
    folder: dir,
  };
}

/** The commands an unmount would run. The folder goes too when it is one the sudo path made (empty, under /media/<user>). */
function unmountPlan(d, opts = {}) {
  const me = { ...who(), ...opts };
  const mp = d.mountpoints[0];
  const mine = mp && mp.startsWith(`${path.posix.join(opts.mediaRoot || '/media', me.user)}/`);
  return {
    udisks: ['udisksctl', ['unmount', '-b', d.path, '--no-user-interaction']],
    sudo: `sudo umount ${q(d.path)}${mine ? ` && (sudo rmdir ${q(mp)} 2>/dev/null || true)` : ''}`,
    folder: mp,
  };
}

/** The current list, read now. */
async function read() {
  const r = await runner('lsblk', ['-J', '-b', '-o', list.COLUMNS]);
  if (r.code !== 0) throw Object.assign(new Error(`lsblk did not answer: ${r.stderr.trim().split('\n')[0] || `exit ${r.code}`}`), { code: 'lsblk' });
  return list.parse(r.stdout, { protect: list.protectedPaths() });
}

/** The device named, from the current list — never a path taken as given. */
async function find(devPath) {
  const all = await read();
  return all.find(d => d.path === devPath) || null;
}

/**
 * Try udisks. → {ok, folder} | {ok: false, needs: 'password', error} when polkit refuses | {ok: false, error}.
 * `verb`: 'mount' | 'unmount'.
 */
async function viaUdisks(d, verb) {
  const plan = verb === 'mount' ? mountPlan(d) : unmountPlan(d);
  const [cmd, args] = plan.udisks;
  const r = await runner(cmd, args).catch(e => ({ code: 127, stdout: '', stderr: e.message }));
  const text = `${r.stdout}\n${r.stderr}`.trim();
  if (r.code === 0) {
    const at = /\bat\s+(\/.+?)\.?\s*$/m.exec(r.stdout);
    return { ok: true, folder: verb === 'mount' ? (at ? at[1] : null) : plan.folder, how: 'udisks' };
  }
  if (r.code === 127) return { ok: false, needs: 'password', error: 'udisks is not installed here', sudo: plan.sudo };
  if (DENIED.test(text)) return { ok: false, needs: 'password', error: 'This hub has no desktop session to allow it without a password.', sudo: plan.sudo };
  return { ok: false, error: text.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 400) || `udisksctl exit ${r.code}` };
}

module.exports = {
  mountPlan, unmountPlan, folderFor, read, find, viaUdisks, who,
  get runner() { return runner; }, set runner(f) { runner = f; },
};
