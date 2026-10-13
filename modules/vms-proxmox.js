'use strict';

/**
 * Proxmox VE in the VMs tab (R16, queue 30): its virtual machines and containers beside libvirt's and VirtualBox's,
 * read and acted on through the API service `proxmox` (api-services/templates/proxmox-ve.openapi.json) — the same
 * definition, key and trusted certificate (cert-pins.js) the agent's calls use, so there is one way to it. Present only
 * once that service is set up (Field → Connectors → API services). A guest is named "<its name> (<vmid>)": names repeat
 * across nodes, ids do not.
 */
const svc = () => require('./api-services/store').get('proxmox');

async function call(action, params = {}) {
  const def = svc();
  if (!def) throw new Error('Proxmox VE is not set up: Field → Connectors → API services, "proxmox".');
  const a = def.actions.find(x => x.name === action);
  if (!a) throw new Error(`The proxmox service has no action ${action}: add it again from the ready-made one.`);
  const r = await require('./api-services/call').send(def, a, { params });
  if (r.error) throw new Error(r.error.replace(/^Error:\s*/, ''));
  if (!r.ok) throw new Error(`Proxmox answered ${r.status}: ${String(r.text || '').slice(0, 200)}`);
  return r.json;
}

const nameOf = g => `${g.name || (g.type === 'lxc' ? 'container' : 'vm')} (${g.vmid})`;

/** listResources' guests → the VMs tab's rows. */
function parse(json, normalizeState) {
  return (json?.data || []).filter(g => g.type === 'qemu' || g.type === 'lxc').map(g => ({
    name: nameOf(g), id: `${g.node}/${g.type}/${g.vmid}`, hypervisor: 'proxmox', stateRaw: g.status || 'unknown', state: normalizeState(g.status || ''),
    node: g.node, kind: g.type === 'lxc' ? 'container' : 'vm', vmid: g.vmid, display: null }));
}

const ACTIONS = { start: true, stop: true, kill: true };
const OP = { qemu: { start: 'vmStart', stop: 'vmShutdown', kill: 'vmStop' }, lxc: { start: 'containerStart', stop: 'containerShutdown', kill: null } };

function hypervisor(normalizeState) {
  const list = async () => parse(await call('listResources'), normalizeState);
  return {
    label: 'Proxmox VE', bin: 'the API service "proxmox"', actions: ACTIONS,
    missing: 'Not set up: add the ready-made "proxmox" in Field → Connectors → API services, with an API token.',
    present: async () => !!svc(),
    list,
    act: async (action, name) => {
      const g = (await list()).find(x => x.name === name);
      if (!g) throw new Error(`No such guest: ${name}`);
      const op = OP[g.kind === 'container' ? 'lxc' : 'qemu'][action];
      if (!op) throw new Error('A container is shut down, not stopped at once, from here.');
      await call(op, { node: g.node, vmid: g.vmid });
      return `${action === 'start' ? 'Starting' : action === 'stop' ? 'Shutting down' : 'Stopping'} ${g.name} on ${g.node}`;
    },
  };
}

module.exports = { hypervisor, parse, nameOf };
