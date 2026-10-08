'use strict';

/**
 * Pictures of the running VMs for Machines → Live, taken by the hypervisor itself while a Live page asks — the same
 * cadence and budget as shots.js: a picture every SHOT_MS, at most MAX_VMS, stopped IDLE_MS after the last ask, kept
 * in memory only (the hypervisor writes a temporary file, read and deleted at once).
 *   libvirt     virsh screenshot <domain> <file>   (PNG on a recent QEMU, PPM on an older one)
 *   VirtualBox  VBoxManage controlvm <vm> screenshotpng <file>
 * Hyper-V, UTM and Parallels have no screenshot their CLI gives without a guest agent: their tile says so.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SHOT_MS = 4000, IDLE_MS = 60000, MAX_VMS = 6;
let _wanted = [], _timer = null, _idle = null, _round = null;
const _shots = new Map();     // key → PNG buffer
const _errors = new Map();    // key → why the last picture failed

const keyOf = vm => `${vm.hypervisor}:${vm.name}`;

/** Why this VM has no picture, or null when its hypervisor can take one. */
function cannot(vm) {
  if (vm.state !== 'running') return 'Not running.';
  if (vm.hypervisor === 'libvirt' || vm.hypervisor === 'virtualbox') return null;
  return `${vm.label || vm.hypervisor} gives no screenshot from its command line; open its own console to see it.`;
}

function argv(vm, file) {
  if (vm.hypervisor === 'libvirt') return ['virsh', [...require('../vms').virshFlags(), 'screenshot', vm.name, file]];
  return ['VBoxManage', ['controlvm', vm.name, 'screenshotpng', file]];
}

async function shoot(vm) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-vmshot-'));
  const file = path.join(dir, 'screen');
  try {
    const [bin, args] = argv(vm, file);
    await new Promise((resolve, reject) => execFile(bin, args, { timeout: 15000, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } },
      (err, _out, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n')[0])) : resolve())));
    _shots.set(keyOf(vm), require('./png').small(fs.readFileSync(file)));
    _errors.delete(keyOf(vm));
  } catch (e) { _errors.set(keyOf(vm), e.message); }
  finally { fs.rm(dir, { recursive: true, force: true }, () => {}); }
}

/** One round: each wanted VM in turn, never two rounds at once (a slow hypervisor makes the round late, not double). */
function round() {
  if (!_round) _round = (async () => { for (const vm of _wanted) await shoot(vm); })().finally(() => { _round = null; });
  return _round;
}

/** The VMs a Live page shows now: pictures for those that can have one; the rest forgotten. */
function want(vms) {
  clearTimeout(_idle);
  _idle = setTimeout(stop, IDLE_MS);
  _idle.unref?.();
  _wanted = vms.filter(v => !cannot(v)).slice(0, MAX_VMS);
  const keep = new Set(_wanted.map(keyOf));
  for (const k of [..._shots.keys()]) if (!keep.has(k)) _shots.delete(k);
  if (!_timer && _wanted.length) {
    _timer = setInterval(round, SHOT_MS);
    _timer.unref?.();
    round();
  }
}

function stop() {
  clearInterval(_timer); clearTimeout(_idle);
  _timer = null; _wanted = []; _shots.clear(); _errors.clear();
}

const get = key => _shots.get(key) || null;
const has = key => _shots.has(key);
const error = key => _errors.get(key) || null;

module.exports = { want, get, has, error, cannot, keyOf, stop, round, SHOT_MS, MAX_VMS };
