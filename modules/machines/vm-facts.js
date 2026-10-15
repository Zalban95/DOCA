'use strict';

/**
 * What a VM is given and how long it has run, for Machines → Live's every-VM view (asked 2026-10-15: "if it has a
 * password we could have the black screen with a lock and just show resources used live and basic info"). Read with
 * vm-list.js's list, so at most every 15 s and shared by everyone asking:
 *   libvirt     `virsh domstats --balloon --vcpu --block` for every machine, running or not (busy-read.js): memory and
 *               processors it is given, its disks (used of size); when it started is its QEMU process's start, read
 *               from /proc (the `-name guest=<name>` argument QEMU is always given) — Linux only
 *   VirtualBox  showvminfo (vms.js already reads it): memory, processors, and when it entered its state
 *   Hyper-V     Get-VM (vms-desktop.js): its CPU now, memory, processors, uptime
 * Live CPU and memory in use for libvirt come from busy.js, which reads them while a page looks. UTM and Parallels
 * give nothing of this from their command line; `reads()` says so in words. Readings only, in fixed words.
 */
const fs = require('fs');

const READS = {
  libvirt: null,
  virtualbox: 'VirtualBox gives no live CPU reading from its command line: memory and processors are what it is given.',
  hyperv: null,
  utm: 'UTM gives no CPU or memory reading from its command line.',
  parallels: 'Parallels gives no CPU or memory reading from its command line.',
  proxmox: null,
};
/** What a hypervisor cannot say here, or null. */
const reads = hv => READS[hv] ?? null;

/** name → when its QEMU process started (ms), for the running libvirt machines named. */
function qemuStarts(names, root = '/proc') {
  const out = new Map();
  if (process.platform !== 'linux' || !names.length) return out;
  const want = new Set(names);
  let boot;
  try { boot = Number(/^btime (\d+)/m.exec(fs.readFileSync(`${root}/stat`, 'utf8'))[1]) * 1000; } catch { return out; }
  const { parseStat, HZ } = require('../processes/read-linux');
  let pids = [];
  try { pids = fs.readdirSync(root).filter(d => /^\d+$/.test(d)); } catch { return out; }
  for (const pid of pids) {
    let cmd;
    try { cmd = fs.readFileSync(`${root}/${pid}/cmdline`, 'latin1'); } catch { continue; }
    if (!/qemu/.test(cmd.slice(0, 200))) continue;
    const name = /\0-name\0guest=((?:[^,\0]|,,)+)/.exec(cmd)?.[1]?.replace(/,,/g, ',');
    if (!name || !want.has(name) || out.has(name)) continue;
    try { out.set(name, boot + parseStat(fs.readFileSync(`${root}/${pid}/stat`, 'utf8')).starttime / HZ * 1000); } catch { /* gone meanwhile */ }
  }
  return out;
}

/** Add `given` and `startedAt` to vm-list's libvirt rows (the others bring their own from vms.js). */
async function addLibvirt(vms) {
  const lv = vms.filter(v => v.hypervisor === 'libvirt');
  if (!lv.length) return vms;
  const given = await require('./busy-read').vmsGiven();
  const starts = qemuStarts(lv.filter(v => v.state === 'running').map(v => v.name));
  for (const v of lv) {
    const g = given.get(v.name);
    if (g) v.given = { vcpus: g.vcpus ?? null, maxKiB: g.maxKiB ?? null, disks: g.disks || [] };
    if (starts.has(v.name)) v.startedAt = starts.get(v.name);
  }
  return vms;
}

const _up = new Map();   // key → the last time it was seen running (this process's memory)
/** Note who runs now; a machine seen running before and not now ran until about now. */
function lastSeen(vms) {
  const now = Date.now();
  for (const v of vms) if (v.state === 'running') _up.set(`${v.hypervisor}:${v.name}`, now);
  return key => _up.get(key) || null;
}

module.exports = { reads, qemuStarts, addLibvirt, lastSeen, _reset: () => _up.clear() };
