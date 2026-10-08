'use strict';

/**
 * The virtual machines, for the status column and Machines → Live (asked 2026-10-08: "show running VMs and computers
 * on the side status column as we do with containers, as well as in Live with the preview"). vms.js's own list —
 * every hypervisor's CLI is a subprocess (virsh, VBoxManage, PowerShell), so it is kept TTL_MS and one ask is shared
 * by everyone asking meanwhile; the sidebar asks every few seconds and must never start a hypervisor CLI each time.
 * A libvirt guest's OS is read once from its definition (the libosinfo id virt-install and virt-manager write) and
 * kept OS_TTL_MS; VirtualBox says it in the description the list already reads.
 */
const { execFile } = require('child_process');

const TTL_MS = 15000, OS_TTL_MS = 10 * 60000;
let _cache = null, _pending = null;
const _os = new Map();   // libvirt name → { at, os }

/** "http://ubuntu.com/ubuntu/24.04" → "ubuntu 24.04"; "http://microsoft.com/win/11" → "win 11". */
function osName(id) {
  const parts = String(id || '').replace(/^https?:\/\/[^/]+\//, '').split('/').filter(Boolean);
  return parts.length ? parts.slice(-2).join(' ') : null;
}

function libvirtOs(name) {
  const hit = _os.get(name);
  if (hit && Date.now() - hit.at < OS_TTL_MS) return Promise.resolve(hit.os);
  const flags = require('../vms').virshFlags();
  return new Promise(resolve => execFile('virsh', [...flags, 'dumpxml', name], { timeout: 10000, maxBuffer: 4 << 20, env: { ...process.env, LC_ALL: 'C' } }, (err, out) => {
    const os = err ? null : osName((/<libosinfo:os id="([^"]+)"/.exec(String(out)) || [])[1]);
    _os.set(name, { at: Date.now(), os });
    resolve(os);
  }));
}

async function read() {
  const hypervisors = await require('../vms').listAll();
  const vms = [];
  for (const hv of hypervisors) for (const vm of hv.vms || []) {
    vms.push({ ...vm, hypervisor: hv.id, label: hv.label, os: vm.os || (hv.id === 'libvirt' ? await libvirtOs(vm.name) : null) });
  }
  return { at: Date.now(), vms, hypervisors: hypervisors.map(({ id, label, available, error }) => ({ id, label, available, error })) };
}

/** Every VM of every hypervisor here, at most TTL_MS old. `fresh` asks again (after an action). */
function list({ fresh = false } = {}) {
  if (!fresh && _cache && Date.now() - _cache.at < TTL_MS) return Promise.resolve(_cache);
  if (_pending) return _pending;
  _pending = read().then(r => (_cache = r), () => (_cache = { at: Date.now(), vms: [], hypervisors: [] })).finally(() => { _pending = null; });
  return _pending;
}

/** One VM by hypervisor and name, from the list — so a name from a request is only ever one that exists. */
async function find(hypervisor, name) {
  return (await list()).vms.find(v => v.hypervisor === hypervisor && v.name === name) || null;
}

module.exports = { list, find, osName, TTL_MS, _reset: () => { _cache = null; _os.clear(); } };
