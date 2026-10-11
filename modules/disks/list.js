'use strict';

/**
 * The hub's disks as Files shows them (asked 2026-10-12: "can't we see [the disk] semi-transparent on Files and mount
 * it by clicking and confirming?"). One read of `lsblk -J -b -o …` (by argv, no shell) turned into the places a person
 * can open, mount or unmount — and the ones they cannot, with why:
 *   mounted     a filesystem with a mount point; unmountable unless it is the system's (/, /boot, /home, swap…) or
 *               holds the user's home, DOCA's data or DOCA's own code
 *   unmounted   a filesystem with none: mountable, drawn faded in Files
 *   encrypted   LUKS or BitLocker with nothing unlocked under it: "encrypted — unlock it first"
 * Left out: loop devices (snaps, images), CD drives with nothing in them, zram, swap that is off, EFI, Microsoft
 * reserved, Windows recovery and BIOS boot partitions (by their partition type), and anything under 1 GB that is
 * FAT or has no filesystem at all — what a desktop's file manager leaves out too.
 * Pure: `parse(json, {protect})` is the whole rule, so a test hands it captured lsblk output.
 */

const COLUMNS = 'NAME,PATH,SIZE,FSTYPE,LABEL,MOUNTPOINTS,TYPE,RM,HOTPLUG,UUID,PARTTYPE';

// Partition types that are the machine's plumbing, never a place: GPT GUIDs and their MBR ids.
const PLUMBING = {
  'c12a7328-f81f-11d2-ba4b-00a0c93ec93b': 'EFI system',
  'e3c9e316-0b5c-4db8-817d-f92df00215ae': 'Microsoft reserved',
  'de94bba4-06d1-4d40-a16a-bfd50179d6ac': 'Windows recovery',
  '21686148-6449-6e6f-744e-656564454649': 'BIOS boot',
  '0657fd6d-a4ab-43c4-84e5-0933c84b4f4f': 'Linux swap',
  '0xef': 'EFI system', '0x27': 'hidden recovery', '0x82': 'Linux swap', '0x12': 'recovery',
};

// Mount points that are the running system: never offered for unmounting.
const SYSTEM = ['/', '/boot', '/boot/efi', '/efi', '/home', '/usr', '/var', '/etc', '/opt', '/srv', '/root', '/nix', '/tmp', '/snap', '[SWAP]'];

const ENCRYPTED = new Set(['crypto_luks', 'bitlocker']);
const MEMBERS = new Set(['lvm2_member', 'linux_raid_member', 'zfs_member', 'ddf_raid_member', 'isw_raid_member']);
const SKIP_TYPES = new Set(['loop', 'zram', 'ram']);
const GB = 1024 ** 3;

const mountsOf = n => (Array.isArray(n.mountpoints) ? n.mountpoints : [n.mountpoint]).filter(m => typeof m === 'string' && m);
const under = (p, mp) => p === mp || (mp !== '/' && p.startsWith(`${mp}/`));

/** Why a mounted filesystem may not be unmounted from here, or null. `protect`: paths whose disk must stay. */
function systemWhy(mps, protect = []) {
  const sys = mps.find(m => SYSTEM.includes(m));
  if (sys) return sys === '[SWAP]' ? 'it is the swap in use' : `it is the system's ${sys}`;
  for (const { path: p, what } of protect) {
    if (p && mps.some(m => under(p, m))) return `${what} is on it`;
  }
  return null;
}

/** One lsblk node that is a place (or would be once mounted), or null for what is left out. */
function place(n, parent, protect) {
  const type = String(n.type || '');
  const fstype = n.fstype ? String(n.fstype) : '';
  const fs = fstype.toLowerCase();
  const size = Number(n.size) || 0;
  const mps = mountsOf(n);
  const ptype = String(n.parttype || '').toLowerCase();
  if (SKIP_TYPES.has(type)) return null;
  if (type === 'rom' && !fstype) return null;                  // an empty CD drive
  if (fs === 'swap' && !mps.length) return null;               // swap that is off is not a place
  if (MEMBERS.has(fs)) return null;                             // a piece of LVM, RAID or ZFS: its volume is the place
  if (PLUMBING[ptype] && !mps.length) return null;             // EFI, MSR, recovery: the machine's plumbing
  if (size < GB && (!fstype || fs === 'vfat') && !mps.length) return null;
  const encrypted = ENCRYPTED.has(fs);
  if (!fstype && !mps.length) return null;                      // unformatted, or a disk whose partitions are listed
  const base = {
    name: n.name, path: n.path || `/dev/${n.name}`, size, fstype, label: n.label || null, uuid: n.uuid || null,
    disk: parent?.name || n.name, removable: !!(n.rm || n.hotplug || parent?.rm || parent?.hotplug), mountpoints: mps,
  };
  if (mps.length) {
    const why = systemWhy(mps, protect);
    return { ...base, state: 'mounted', canMount: false, canUnmount: !why, why };
  }
  if (encrypted) return { ...base, state: 'encrypted', canMount: false, canUnmount: false, why: 'encrypted — unlock it first' };
  return { ...base, state: 'unmounted', canMount: true, canUnmount: false, why: null };
}

/**
 * lsblk's JSON → the places: the leaves of its tree. A disk with partitions is its partitions, an encrypted partition
 * whose unlocked mapping is listed under it is that mapping, an LVM volume group's member is its volumes.
 */
function parse(json, { protect = [] } = {}) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const out = [];
  const walk = (n, parent) => {
    const kids = Array.isArray(n.children) ? n.children : [];
    if (!kids.length) {
      const p = place(n, parent, protect);
      if (p) out.push(p);
    }
    for (const k of kids) walk(k, n.type === 'disk' ? n : parent);
  };
  for (const n of data?.blockdevices || []) walk(n, null);
  return out;
}

/** What may never be unmounted from here, by what it holds: the person's home, DOCA's data, DOCA's own code. */
function protectedPaths() {
  const path = require('path');
  return [
    { path: require('os').homedir(), what: 'the home folder' },
    { path: require('../store').DATA_DIR, what: 'DOCA\'s data' },
    { path: path.resolve(__dirname, '..', '..'), what: 'DOCA itself' },
    { path: process.env.DOCA_HOME, what: 'DOCA\'s install' },
  ].filter(p => p.path).map(p => ({ ...p, path: path.resolve(p.path) }));
}

/** The name a mount folder gets: the label, else the UUID, else the device's name — one path segment, no separators. */
function folderName(d) {
  const raw = String(d.label || d.uuid || d.name || 'disk');
  const clean = raw.replace(/[\u0000-\u001f\u007f/\\]/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
  return clean || String(d.name || 'disk');
}

module.exports = { COLUMNS, PLUMBING, SYSTEM, parse, systemWhy, protectedPaths, folderName };
