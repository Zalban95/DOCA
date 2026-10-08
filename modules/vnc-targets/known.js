'use strict';

/**
 * The VNC displays DOCA already knows of, listed beside the targets read-only (asked 2026-10-08: not duplicated as
 * targets): a running VM's VNC display (its hypervisor names it — machines/vm-list.js) and the agents' computers' own
 * live views (computers/vnc.js). A target pointing at one of them is shown once — as the target, saying whose display it
 * is — so `same()` matches a target's address with a VM's, where this machine's own addresses all count as one.
 */
const { ownAddress } = require('../machines/vm-console');

const addrKey = (host, port) => `${ownAddress(host) ? 'this-machine' : String(host).replace(/^\[|\]$/g, '').toLowerCase()}:${Number(port)}`;

/** A VM's VNC display as an address: libvirt writes a display by its number (vnc://host:2 is port 5902). */
function vmAddress(vm) {
  const d = vm?.display;
  if (!d || d.protocol !== 'vnc' || d.port == null) return null;
  return { host: d.host, port: vm.hypervisor === 'libvirt' && d.port < 5900 ? 5900 + d.port : d.port };
}

/** `have`: the VMs and computers when the caller already read them (machines/rows.js), so nothing is asked twice. */
async function known(have = {}) {
  const out = [];
  let vms = have.vms || [];
  if (!have.vms) try { vms = (await require('../machines/vm-list').list()).vms; } catch { /* no hypervisor */ }
  for (const vm of vms) {
    const at = vmAddress(vm);
    if (!at) continue;
    const opening = require('../machines/vm-console').where(vm);
    out.push({ kind: 'vm', id: `${vm.hypervisor}:${vm.name}`, name: vm.name, label: vm.label, host: at.host, port: at.port, key: addrKey(at.host, at.port),
      opens: opening.how === 'hub' ? 'hub' : 'viewer', why: opening.how === 'hub' ? null : opening.why });
  }
  let computers = have.computers || [];
  if (!have.computers) try { computers = await require('../computers').detailed(); } catch { /* no computers */ }
  for (const c of computers) if (c.state === 'running') out.push({ kind: 'computer', id: c.id, name: c.name, host: null, port: null, key: null, opens: 'computers' });
  return out;
}

/** Which known display a target is, or null. */
function same(target, displays) {
  const key = addrKey(target.host, target.port);
  return displays.find(k => k.key === key) || null;
}

module.exports = { known, same, addrKey, vmAddress };
