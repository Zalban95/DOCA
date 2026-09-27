'use strict';

/**
 * Managing libvirt machines beyond start and stop: details, autostart,
 * snapshots, and making a new one (virt-install). The VMs tab's management
 * half; modules/vms.js keeps listing and power.
 *
 * Every name from the client is checked against the machines that exist (and a
 * snapshot's against that machine's snapshots) before it reaches argv; nothing
 * goes through a shell.
 *
 *   GET  /api/vms/libvirt/:name              details + snapshots
 *   POST /api/vms/libvirt/:name/autostart    { on }
 *   POST /api/vms/libvirt/:name/snapshots    { snapshot } take one
 *   POST /api/vms/libvirt/:name/snapshots/:snap/revert
 *   DELETE /api/vms/libvirt/:name/snapshots/:snap
 *   POST /api/vms/libvirt/create             { name, iso, memoryMb, vcpus, diskGb, osVariant? }
 */
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const pexec = promisify(execFile);
const { loadPrefs, fmSafe } = require('./utils');

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const flags = () => { const u = (loadPrefs().vms?.libvirtUri || '').trim(); return u ? ['-c', u] : []; };

async function virsh(args, timeout = 60000) {
  try {
    const { stdout } = await pexec('virsh', [...flags(), ...args], { env: { ...process.env, LC_ALL: 'C', LANG: 'C' }, timeout, maxBuffer: 4 << 20 });
    return stdout;
  } catch (e) { throw bad((e.stderr || e.message || '').toString().trim().replace(/^error: /i, '').split('\n')[0], 500); }
}

/** `virsh dominfo` → { cpus, memoryMb, autostart, persistent, state } */
function parseDominfo(out) {
  const v = k => (new RegExp(`^${k}:\\s*(.+)$`, 'mi').exec(out) || [])[1]?.trim();
  return { state: v('State') || null, cpus: Number(v('CPU\\(s\\)')) || null, memoryMb: Math.round((parseInt(v('Max memory'), 10) || 0) / 1024) || null,
    autostart: v('Autostart') === 'enable', persistent: v('Persistent') === 'yes' };
}

/** `virsh snapshot-list --name` → names, oldest first as virsh gives them. */
function parseSnapshots(out) { return String(out).split('\n').map(s => s.trim()).filter(Boolean); }

async function known(name) {
  if (!NAME.test(String(name || ''))) throw bad('Not a machine name.');
  const names = parseSnapshots(await virsh(['list', '--all', '--name']));
  if (!names.includes(name)) throw bad(`No such machine: ${name}`, 404);
}

async function details(name) {
  await known(name);
  const info = parseDominfo(await virsh(['dominfo', name]));
  let snapshots = [];
  try { snapshots = parseSnapshots(await virsh(['snapshot-list', name, '--name'])); } catch { /* storage without snapshots */ }
  let current = null;
  try { current = (await virsh(['snapshot-current', name, '--name'])).trim() || null; } catch { /* none */ }
  return { name, ...info, snapshots, currentSnapshot: current };
}

async function autostart(name, on) { await known(name); await virsh(['autostart', name, ...(on ? [] : ['--disable'])]); return details(name); }

async function snapshot(name, snap) {
  await known(name);
  const s = String(snap || '').trim() || `doca-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')}`;
  if (!NAME.test(s)) throw bad('A snapshot name is letters, digits, _ . - (up to 64).');
  await virsh(['snapshot-create-as', name, s, '--description', 'Taken from the DOCA panel', '--atomic'], 10 * 60e3);
  return details(name);
}

async function snapshotAct(name, snap, act) {
  await known(name);
  const list = parseSnapshots(await virsh(['snapshot-list', name, '--name']));
  if (!list.includes(snap)) throw bad(`${name} has no snapshot "${snap}".`, 404);
  await virsh(act === 'revert' ? ['snapshot-revert', name, snap] : ['snapshot-delete', name, snap], 10 * 60e3);
  return details(name);
}

/** A new machine from an ISO: qcow2 disk in libvirt's default pool, VNC on this machine only. */
async function create({ name, iso, memoryMb = 4096, vcpus = 2, diskGb = 40, osVariant = '' } = {}) {
  if (!NAME.test(String(name || ''))) throw bad('A machine name is letters, digits, _ . - (up to 64).');
  const names = parseSnapshots(await virsh(['list', '--all', '--name']));
  if (names.includes(name)) throw bad(`There is already a machine called ${name}.`, 409);
  if (!iso || !fmSafe(iso) || !fs.existsSync(iso) || !/\.iso$/i.test(iso)) throw bad('Choose an .iso file on this machine (inside the allowed folders).');
  const n = (v, lo, hi, what) => { const x = Number(v); if (!Number.isInteger(x) || x < lo || x > hi) throw bad(`${what} is between ${lo} and ${hi}.`); return x; };
  const mem = n(memoryMb, 512, 262144, 'Memory (MB)'), cpu = n(vcpus, 1, 128, 'CPUs'), disk = n(diskGb, 4, 4096, 'Disk (GB)');
  if (osVariant && !/^[a-z0-9._-]{1,40}$/.test(osVariant)) throw bad('Not an OS variant (see virt-install --osinfo list).');
  const args = ['--name', name, '--memory', String(mem), '--vcpus', String(cpu), '--disk', `size=${disk},format=qcow2`,
    '--cdrom', iso, '--osinfo', osVariant ? `name=${osVariant}` : 'detect=on,require=off',
    '--graphics', 'vnc,listen=127.0.0.1', '--noautoconsole', '--wait', '0'];
  const uri = (loadPrefs().vms?.libvirtUri || '').trim();
  try {
    await pexec('virt-install', [...(uri ? ['--connect', uri] : []), ...args], { env: { ...process.env, LC_ALL: 'C' }, timeout: 10 * 60e3, maxBuffer: 4 << 20 });
  } catch (e) { throw bad(`virt-install: ${(e.stderr || e.message).toString().trim().split('\n').slice(-2).join(' ')}`, 500); }
  return details(name);
}

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };

function mount(app) {
  app.post('/api/vms/libvirt/create', h(req => create(req.body || {})));
  app.get('/api/vms/libvirt/:name', h(req => details(req.params.name)));
  app.post('/api/vms/libvirt/:name/autostart', h(req => autostart(req.params.name, req.body?.on === true)));
  app.post('/api/vms/libvirt/:name/snapshots', h(req => snapshot(req.params.name, req.body?.snapshot)));
  app.post('/api/vms/libvirt/:name/snapshots/:snap/revert', h(req => snapshotAct(req.params.name, req.params.snap, 'revert')));
  app.delete('/api/vms/libvirt/:name/snapshots/:snap', h(req => snapshotAct(req.params.name, req.params.snap, 'delete')));
}

module.exports = { mount, parseDominfo, parseSnapshots, details, create };
