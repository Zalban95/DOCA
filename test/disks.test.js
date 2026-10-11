'use strict';

/**
 * Files' disks (asked 2026-10-12): which disks are offered, faded, for mounting; which mounted ones may be unmounted;
 * the commands a mount would run; and the routes — all against captured or written lsblk output and a stub runner,
 * so no test ever lists, mounts or unmounts a real disk. `fixtures/lsblk-hub.json` is the hub's own lsblk, captured
 * read-only: an 8 TB NTFS data disk (sda2, "New Volume") unmounted, a Windows NVMe with its EFI, reserved and recovery
 * partitions, and the running system on sdb4 (/), nvme1n1p2 (/home) and nvme0n1p5 (where this checkout lives).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const h = require('./helpers');           // first: it sets the env
const list = require('../modules/disks/list');
const mount = require('../modules/disks/mount');
const hub = require('./fixtures/lsblk-hub.json');

const byName = (all, n) => all.find(d => d.name === n);

test('the hub\'s disks: the data disk and Windows\' own partition are offered, the plumbing is not', () => {
  const all = list.parse(hub, { protect: [{ path: '/media/al/NewVolume/shared/projects/workspace/doca', what: 'DOCA itself' }] });
  const sda2 = byName(all, 'sda2');
  assert.equal(sda2.state, 'unmounted');
  assert.equal(sda2.canMount, true);
  assert.equal(sda2.label, 'New Volume');
  assert.equal(sda2.fstype, 'ntfs');
  assert.equal(sda2.size, 8001426554880);
  assert.equal(byName(all, 'nvme0n1p3').canMount, true, 'the Windows system partition is a place');
  for (const n of ['sda', 'sda1', 'sdb1', 'nvme0n1p1', 'nvme0n1p2', 'nvme0n1p4', 'nvme0n1p6', 'nvme1n1p1', 'loop0']) {
    assert.equal(byName(all, n), undefined, `${n} is left out (a whole disk, EFI, reserved, recovery or a loop)`);
  }
});

test('the system\'s own filesystems, and the one this checkout is on, are never offered for unmounting', () => {
  const all = list.parse(hub, { protect: [{ path: '/media/al/NewVolume/shared/projects/workspace/doca', what: 'DOCA itself' }] });
  const root = byName(all, 'sdb4');
  assert.equal(root.state, 'mounted');
  assert.equal(root.canUnmount, false);
  assert.match(root.why, /system's \//);
  assert.equal(byName(all, 'sdb3').canUnmount, false, '/boot/efi stays');
  assert.match(byName(all, 'nvme1n1p2').why, /\/home/);
  const store = byName(all, 'nvme0n1p5');
  assert.equal(store.canUnmount, false);
  assert.equal(store.why, 'DOCA itself is on it');
  assert.deepEqual(store.mountpoints, ['/var/lib/containerd', '/media/al/NewVolume', '/mnt/store']);
});

const synthetic = { blockdevices: [
  { name: 'sdc', path: '/dev/sdc', size: 64e9, type: 'disk', rm: true, hotplug: true, children: [
    { name: 'sdc1', path: '/dev/sdc1', size: 64e9, fstype: 'vfat', label: 'STICK', mountpoints: ['/media/u/STICK'], type: 'part', rm: true, hotplug: true }] },
  { name: 'sdd', path: '/dev/sdd', size: 500e9, type: 'disk', children: [
    { name: 'sdd1', path: '/dev/sdd1', size: 100e6, fstype: 'vfat', mountpoints: [null], type: 'part' },
    { name: 'sdd2', path: '/dev/sdd2', size: 200e9, fstype: 'crypto_LUKS', mountpoints: [null], type: 'part' },
    { name: 'sdd3', path: '/dev/sdd3', size: 100e9, fstype: 'crypto_LUKS', mountpoints: [null], type: 'part', children: [
      { name: 'luks-1', path: '/dev/mapper/luks-1', size: 100e9, fstype: 'ext4', label: 'vault', mountpoints: [null], type: 'crypt' }] },
    { name: 'sdd4', path: '/dev/sdd4', size: 150e9, fstype: 'BitLocker', mountpoints: [null], type: 'part' },
    { name: 'sdd5', path: '/dev/sdd5', size: 40e9, fstype: 'LVM2_member', mountpoints: [null], type: 'part', children: [
      { name: 'vg-data', path: '/dev/mapper/vg-data', size: 40e9, fstype: 'xfs', mountpoints: [null], type: 'lvm' }] },
    { name: 'sdd6', path: '/dev/sdd6', size: 8e9, fstype: 'swap', mountpoints: [null], type: 'part' }] },
  { name: 'sr0', path: '/dev/sr0', size: 1073741312, type: 'rom', rm: true, mountpoints: [null] },
] };

test('a USB stick may be unmounted; encrypted disks say to unlock first; small FAT, swap, LVM members and an empty drive are left out', () => {
  const all = list.parse(synthetic);
  const stick = byName(all, 'sdc1');
  assert.equal(stick.canUnmount, true);
  assert.equal(stick.removable, true);
  assert.equal(byName(all, 'sdd2').state, 'encrypted');
  assert.equal(byName(all, 'sdd2').why, 'encrypted — unlock it first');
  assert.equal(byName(all, 'sdd4').state, 'encrypted', 'BitLocker too');
  assert.equal(byName(all, 'sdd3'), undefined, 'an unlocked LUKS partition is its mapping');
  assert.equal(byName(all, 'luks-1').canMount, true);
  assert.equal(byName(all, 'vg-data').canMount, true);
  for (const n of ['sdd1', 'sdd5', 'sdd6', 'sr0', 'sdd']) assert.equal(byName(all, n), undefined, n);
});

test('the commands a mount would run: udisks by argv, and the sudo path with the user\'s uid for NTFS', () => {
  const sda2 = byName(list.parse(hub), 'sda2');
  const p = mount.mountPlan(sda2, { user: 'al', uid: 1000, gid: 1000, exists: () => false });
  assert.deepEqual(p.udisks, ['udisksctl', ['mount', '-b', '/dev/sda2', '--no-user-interaction']]);
  assert.equal(p.sudo, "sudo mkdir -p '/media/al/New Volume' && sudo mount -o nosuid,nodev,uid=1000,gid=1000,umask=022 '/dev/sda2' '/media/al/New Volume'");
  const vault = byName(list.parse(synthetic), 'luks-1');
  assert.equal(mount.mountPlan(vault, { user: 'al', uid: 1000, gid: 1000, exists: () => false }).sudo,
    "sudo mkdir -p '/media/al/vault' && sudo mount -o nosuid,nodev '/dev/mapper/luks-1' '/media/al/vault'", 'ext4 keeps its own owners');
  const odd = { name: 'sde1', path: '/dev/sde1', label: "it's/../x", fstype: 'exfat' };
  assert.equal(mount.folderFor(odd, { user: 'al', exists: () => false }), "/media/al/it's_.._x", 'a label is one path segment');
  assert.match(mount.mountPlan(odd, { user: 'al', uid: 1, gid: 1, exists: () => false }).sudo, /'\/media\/al\/it'\\''s_\.\._x'/, 'and is quoted');
  assert.equal(mount.folderFor(sda2, { user: 'al', exists: () => true, empty: () => false }), '/media/al/New Volume-sda2', 'a taken folder is not mounted over');
  const stick = byName(list.parse(synthetic), 'sdc1');
  assert.equal(mount.unmountPlan(stick, { user: 'u' }).sudo, "sudo umount '/dev/sdc1' && (sudo rmdir '/media/u/STICK' 2>/dev/null || true)");
});

test('udisks: mounted, refused by polkit (the password then), not installed, or a real error said as it is', async () => {
  const sda2 = byName(list.parse(hub), 'sda2');
  const was = mount.runner;
  try {
    mount.runner = async () => ({ code: 0, stdout: 'Mounted /dev/sda2 at /media/al/New Volume\n', stderr: '' });
    assert.deepEqual(await mount.viaUdisks(sda2, 'mount'), { ok: true, folder: '/media/al/New Volume', how: 'udisks' });
    mount.runner = async () => ({ code: 1, stdout: '', stderr: 'Error mounting /dev/sda2: GDBus.Error:org.freedesktop.UDisks2.Error.NotAuthorizedCanObtain: Not authorized to perform operation' });
    const denied = await mount.viaUdisks(sda2, 'mount');
    assert.equal(denied.needs, 'password');
    mount.runner = async () => ({ code: 127, stdout: '', stderr: 'spawn udisksctl ENOENT' });
    assert.equal((await mount.viaUdisks(sda2, 'mount')).needs, 'password');
    mount.runner = async () => ({ code: 1, stdout: '', stderr: 'Error mounting /dev/sda2: wrong fs type\nThe disk contains an unclean file system (0, 0).\nWindows is hibernated, refused to mount.' });
    const r = await mount.viaUdisks(sda2, 'mount');
    assert.equal(r.ok, false);
    assert.equal(r.needs, undefined);
    assert.match(r.error, /hibernated/);
  } finally { mount.runner = was; }
});

// ── The routes, with a stub runner that knows only lsblk and udisksctl ──
const routeDisks = { blockdevices: [
  { name: 'sdx', path: '/dev/sdx', size: 2e12, type: 'disk', children: [
    { name: 'sdx1', path: '/dev/sdx1', size: 2e12, fstype: 'ntfs', label: 'Data', mountpoints: [null], type: 'part' }] },
  { name: 'sdy', path: '/dev/sdy', size: 32e9, type: 'disk', rm: true, children: [
    { name: 'sdy1', path: '/dev/sdy1', size: 32e9, fstype: 'exfat', label: 'CARD', mountpoints: ['/media/u/CARD'], type: 'part', rm: true }] },
  { name: 'sdz', path: '/dev/sdz', size: 200e9, type: 'disk', children: [
    { name: 'sdz1', path: '/dev/sdz1', size: 200e9, fstype: 'ext4', mountpoints: ['/'], type: 'part' }] },
] };
const ran = [];
let udisks = { code: 0, stdout: 'Mounted /dev/sdx1 at /media/u/Data\n', stderr: '' };

test.before(async () => {
  await h.start();
  mount.runner = async (cmd, args) => {
    ran.push([cmd, ...args]);
    if (cmd === 'lsblk') return { code: 0, stdout: JSON.stringify(routeDisks), stderr: '' };
    if (cmd === 'udisksctl') return udisks;
    throw new Error(`the test runner refuses ${cmd}`);
  };
});
test.after(async () => { await h.stop(); });

const linux = process.platform === 'linux';

test('GET /api/files/disks: places with their space, and the disks to mount', async () => {
  const r = await h.api(null, 'GET', '/api/files/disks');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.mounted) && r.body.mounted.length, 'at least the home folder');
  const home = r.body.mounted.find(m => m.home);
  if (home && home.total != null) assert.ok(home.total >= home.free && home.used >= 0, 'used, total and free from statfs');
  if (!linux) {
    assert.equal(r.body.supported, false);
    assert.ok(r.body.note, 'macOS and Windows say why nothing is mounted from here');
    return;
  }
  assert.equal(r.body.supported, true);
  const data = r.body.unmounted.find(d => d.path === '/dev/sdx1');
  assert.deepEqual([data.label, data.fstype, data.canMount], ['Data', 'ntfs', true]);
});

test('POST mount and unmount: refusals first, then udisks, and an activity line', { skip: !linux && 'Linux only' }, async () => {
  assert.equal((await h.api(null, 'POST', '/api/files/disks/mount', { device: '../etc' })).status, 400);
  assert.equal((await h.api(null, 'POST', '/api/files/disks/mount', { device: '/dev/sdq9' })).status, 404);
  const sys = await h.api(null, 'POST', '/api/files/disks/unmount', { device: '/dev/sdz1' });
  assert.equal(sys.status, 409);
  assert.match(sys.body.error, /system's \//);
  assert.equal((await h.api(null, 'POST', '/api/files/disks/mount', { device: '/dev/sdy1' })).status, 409, 'already mounted');

  ran.length = 0;
  const ok = await h.api(null, 'POST', '/api/files/disks/mount', { device: '/dev/sdx1' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true, folder: '/media/u/Data', how: 'udisks' });
  assert.deepEqual(ran.find(c => c[0] === 'udisksctl'), ['udisksctl', 'mount', '-b', '/dev/sdx1', '--no-user-interaction']);
  const line = require('../modules/activity').list({ limit: 50 }).find(l => /mounted the disk Data \(\/dev\/sdx1\)/.test(l.what));
  assert.ok(line, 'the mount is a line');
  assert.equal(line.act, 'mount');
  assert.equal(line.ok, true);

  udisks = { code: 1, stdout: '', stderr: 'GDBus.Error:org.freedesktop.UDisks2.Error.NotAuthorized: Not authorized' };
  const ask = await h.api(null, 'POST', '/api/files/disks/unmount', { device: '/dev/sdy1' });
  assert.equal(ask.body.needs, 'password', 'polkit said no: the panel asks for the sudo password');
});

test('with the password the sudo path runs through streamCmd, and its outcome is read back', { skip: !linux && 'Linux only' }, async () => {
  const utils = require('../modules/utils');
  const real = utils.streamCmd;
  let got = null;
  utils.streamCmd = (res, cmd, opts) => { got = { cmd, password: opts.password }; res.setHeader('Content-Type', 'text/event-stream'); res.end('data: {"done":true,"ok":true}\n\n'); };
  try {
    const r = await h.api(null, 'POST', '/api/files/disks/mount', { device: '/dev/sdx1', password: 'pw' });
    assert.equal(r.status, 200);
    assert.equal(got.password, 'pw');
    assert.match(got.cmd, /^sudo mkdir -p '\/media\/[^']+\/Data' && sudo mount -o nosuid,nodev,uid=\d+,gid=\d+,umask=022 '\/dev\/sdx1' '\/media\/[^']+\/Data'$/);
  } finally { utils.streamCmd = real; }
});

test('the hub\'s own data and code are protected by path', () => {
  const p = list.protectedPaths();
  assert.ok(p.some(x => x.what === 'DOCA itself' && x.path === path.resolve(__dirname, '..')));
  assert.ok(p.some(x => x.what === 'the home folder'));
});
