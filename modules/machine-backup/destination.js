'use strict';

/**
 * Whether the backup's destination can be reached now, and how much room it has.
 *
 * A folder on a disk that comes and goes (a USB disk, a NAS mount) is the usual destination, and the one trap is an
 * empty mount point: /media/<you>/Backup still exists when the disk is unplugged, and writing there fills the system
 * disk instead. So a folder under a mount place (/media, /run/media, /mnt, /Volumes) counts as reachable only when its
 * mount point is a different filesystem from the folder above it. A Windows drive letter that is not there is a disk
 * not plugged in. A restic address (sftp:, s3:…) is found out by trying it, when the backup runs.
 */
const fs = require('fs');
const path = require('path');

const { isRemote } = require('./config');

/** The mount point a path would sit on, when it is under a place disks are mounted, else null. */
function mountPoint(p, platform = process.platform) {
  if (platform === 'win32') { const m = /^([A-Za-z]:)[\\/]?/.exec(p); return m ? `${m[1].toUpperCase()}\\` : null; }
  const s = path.posix.normalize(p).split('/').filter(Boolean);
  if (s[0] === 'media' && s.length >= 3) return '/' + s.slice(0, 3).join('/');
  if (s[0] === 'run' && s[1] === 'media' && s.length >= 4) return '/' + s.slice(0, 4).join('/');
  if ((s[0] === 'mnt' || s[0] === 'Volumes') && s.length >= 2) return '/' + s.slice(0, 2).join('/');
  return null;
}

function howToMount(platform = process.platform) {
  if (platform === 'win32') return 'Plug the disk in (it gets its drive letter back), or reconnect the network drive.';
  if (platform === 'darwin') return 'Plug the disk in, or connect the network share in Finder: it appears under /Volumes.';
  return 'Plug the disk in and open it in the file manager, or mount it (udisksctl mount -b /dev/sdX1, or mount the NAS share).';
}

/**
 * {set, kind: folder|remote, reachable: true|false|null, freeBytes, initialized, note}. `machine` stands in for this one
 * in tests: {platform, stat(p) → {dev, isDirectory()} | null, statfs(p) → {bavail, bsize} | null}.
 */
function check(repo, machine = {}) {
  const platform = machine.platform || process.platform;
  const stat = machine.stat || (p => { try { return fs.statSync(p); } catch { return null; } });
  const statfs = machine.statfs || (p => { try { return fs.statfsSync(p); } catch { return null; } });
  if (!repo) return { set: false, kind: null, reachable: false, note: 'Not set yet: choose a folder on another disk, a NAS or a USB disk.' };
  if (isRemote(repo)) return { set: true, kind: 'remote', reachable: null, initialized: null, note: 'An address: whether it answers is found when the backup runs.' };

  const mp = mountPoint(repo, platform);
  if (mp) {
    const at = stat(mp);
    if (!at) return { set: true, kind: 'folder', reachable: false, notMounted: true, note: `${mp} is not there: the disk is not connected. ${howToMount(platform)}` };
    if (platform !== 'win32') {
      const above = stat(path.posix.dirname(mp));
      if (above && at.dev === above.dev) return { set: true, kind: 'folder', reachable: false, notMounted: true,
        note: `${mp} is an empty mount point — the disk is not mounted, and writing there would fill this machine's own disk. ${howToMount(platform)}` };
    }
  }
  // The folder itself, or the nearest folder above it that exists (the repository is made inside it when set up).
  let probe = repo;
  while (!stat(probe)) { const up = (platform === 'win32' ? path.win32 : path.posix).dirname(probe); if (up === probe) break; probe = up; }
  const st = stat(probe);
  if (!st || !st.isDirectory()) return { set: true, kind: 'folder', reachable: false, note: `${probe} is not a folder.` };
  let writable = true;
  if (!machine.stat) { try { fs.accessSync(probe, fs.constants.W_OK); } catch { writable = false; } }
  if (!writable) return { set: true, kind: 'folder', reachable: false, note: `${probe} cannot be written by ${require('../branding').name('product')} (its permissions).` };
  const f = statfs(probe);
  const initialized = !!stat((platform === 'win32' ? path.win32 : path.posix).join(repo, 'config'));
  return { set: true, kind: 'folder', reachable: true, initialized, freeBytes: f ? Number(f.bavail) * Number(f.bsize) : null,
    note: initialized ? 'Reachable.' : probe === repo ? 'Reachable; the backup is made inside it when it is set up.' : `Reachable; ${repo} is made when it is set up.` };
}

/** Whether a path lies inside a folder (both as this OS spells them). */
function inside(p, dir, platform = process.platform) {
  const P = platform === 'win32' ? path.win32 : path.posix;
  const rel = P.relative(dir, p);
  return rel === '' || (!!rel && !rel.startsWith('..') && !P.isAbsolute(rel));
}

module.exports = { check, mountPoint, howToMount, inside };
