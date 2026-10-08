'use strict';

/**
 * Virtual machines, through whichever hypervisor CLI is on the box.
 *
 * Two are supported and both are optional: libvirt/KVM (`virsh`) and
 * VirtualBox (`VBoxManage`). Neither being installed is a normal state, not an
 * error — the panel says which are missing and offers what is there.
 *
 * Commands are run with an argv array and no shell, and a name coming from the
 * client is checked against the machines that actually exist before it is
 * passed to anything. A VM called `--all` is not going to become an argument.
 */
const { execFile } = require('child_process');
const { promisify } = require('util');

const { loadPrefs, savePrefs } = require('./utils');

const pexec = promisify(execFile);

const PREFS_KEY = 'vms';

/** `virsh` talks about "shut off"; the panel only cares about three states. */
function normalizeState(raw) {
  const s = (raw || '').toLowerCase();
  if (s.includes('running') || s === 'up' || s === 'started') return 'running';   // UTM says started
  if (s.includes('paused')  || s.includes('suspend') || s === 'saved') return 'paused';   // Hyper-V's Saved is a suspended VM
  if (s.includes('shut')    || s.includes('off') || s.includes('poweroff')) return 'stopped';
  return s || 'unknown';
}

/**
 * Run a hypervisor command.
 *
 * `LC_ALL=C` because the state words are parsed and a localised virsh would
 * otherwise report states this does not recognise.
 */
async function run(bin, args) {
  const { stdout } = await pexec(bin, args, {
    env:      { ...process.env, LC_ALL: 'C', LANG: 'C' },
    timeout:  20000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

function libvirtUri() {
  return (loadPrefs()[PREFS_KEY]?.libvirtUri || '').trim();
}

/** Global virsh flags: the connection URI, when one has been configured. */
function virshFlags() {
  const uri = libvirtUri();
  return uri ? ['-c', uri] : [];
}

/* ── libvirt / KVM ────────────────────────────────────── */

const LIBVIRT_ACTIONS = {
  start:  n => ['start', n],
  stop:   n => ['shutdown', n],     // asks the guest politely
  reboot: n => ['reboot', n],
  kill:   n => ['destroy', n],      // pulls the plug
  resume: n => ['resume', n],       // a paused domain cannot be started again
};

/**
 * `virsh list --all` prints a table:
 *
 *      Id   Name      State
 *     ---------------------------
 *      1    win11     running
 *      -    ubuntu    shut off
 */
function parseVirshList(stdout) {
  const lines = stdout.split('\n').map(l => l.trimEnd());
  const start = lines.findIndex(l => /^\s*-{3,}/.test(l));
  return lines.slice(start + 1)
    .map(l => l.match(/^\s*(\S+)\s+(\S+)\s+(.*?)\s*$/))
    .filter(Boolean)
    .map(([, id, name, state]) => ({
      id:       id === '-' ? null : id,
      name,
      state:    normalizeState(state),
      stateRaw: state,
    }));
}

/**
 * Where to point a viewer. `domdisplay` covers VNC and SPICE alike and is what
 * virt-viewer itself uses, so it beats guessing from `vncdisplay`.
 */
async function libvirtDisplay(name) {
  try {
    const out = (await run('virsh', [...virshFlags(), 'domdisplay', name])).trim().split('\n')[0]?.trim();
    if (!out) return null;
    const u = new URL(out);
    return {
      uri:      out,
      protocol: u.protocol.replace(':', ''),
      host:     u.hostname || '127.0.0.1',
      port:     u.port ? Number(u.port) : null,
    };
  } catch { return null; }
}

async function libvirtList() {
  const vms = parseVirshList(await run('virsh', [...virshFlags(), 'list', '--all']));
  return Promise.all(vms.map(async vm => ({
    ...vm,
    hypervisor: 'libvirt',
    display:    vm.state === 'running' ? await libvirtDisplay(vm.name) : null,
  })));
}

/* ── VirtualBox ───────────────────────────────────────── */

const VBOX_ACTIONS = {
  start:  n => ['startvm', n, '--type', 'headless'],
  stop:   n => ['controlvm', n, 'acpipowerbutton'],
  reboot: n => ['controlvm', n, 'reset'],
  kill:   n => ['controlvm', n, 'poweroff'],
  resume: n => ['controlvm', n, 'resume'],
};

/** `VBoxManage list vms` prints `"name" {uuid}` per line. */
function parseVboxList(stdout) {
  return stdout.split('\n')
    .map(l => l.match(/^"(.*)"\s+\{([0-9a-f-]+)\}\s*$/i))
    .filter(Boolean)
    .map(([, name, id]) => ({ name, id }));
}

/**
 * VirtualBox's remote display is VRDE — RDP, not VNC, unless the VNC extension
 * pack is installed. Report the protocol rather than calling it all VNC.
 */
function parseVboxDisplay(info) {
  const field = k => info.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))?.[1] || '';
  if (field('vrde') !== 'on') return null;
  const port = parseInt((field('vrdeports') || field('vrdeport')).split(',')[0], 10);
  const host = field('vrdeaddress') || '127.0.0.1';
  if (!Number.isFinite(port) || port <= 0) return null;
  const protocol = /vnc/i.test(field('vrdeproperty[TCP/Ports]') + field('vrdeextpack')) ? 'vnc' : 'rdp';
  return { uri: `${protocol}://${host}:${port}`, protocol, host, port };
}

async function vboxList() {
  const [all, running] = await Promise.all([
    run('VBoxManage', ['list', 'vms']),
    run('VBoxManage', ['list', 'runningvms']).catch(() => ''),
  ]);
  const up = new Set(parseVboxList(running).map(v => v.name));

  return Promise.all(parseVboxList(all).map(async vm => {
    let display = null, os = null, stateRaw = up.has(vm.name) ? 'running' : 'poweroff';
    try {
      const info = await run('VBoxManage', ['showvminfo', vm.name, '--machinereadable']);
      stateRaw = info.match(/^VMState="(.*)"$/m)?.[1] || stateRaw;
      os = info.match(/^ostype="(.*)"$/m)?.[1] || null;
      if (up.has(vm.name)) display = parseVboxDisplay(info);
    } catch { /* a VM mid-registration can fail to describe itself */ }
    return { ...vm, hypervisor: 'virtualbox', state: normalizeState(stateRaw), stateRaw, display, os };
  }));
}

/* ── Both together ───────────────────────────────────── */

const HYPERVISORS = {
  libvirt:    { label: 'libvirt / KVM', bin: 'virsh',      list: libvirtList, actions: LIBVIRT_ACTIONS, flags: virshFlags },
  virtualbox: { label: 'VirtualBox',    bin: 'VBoxManage', list: vboxList,    actions: VBOX_ACTIONS,    flags: () => [] },
  // Hyper-V, UTM, Parallels (vms-desktop.js): each knows how it is found and how an action is invoked.
  ...require('./vms-desktop').hypervisors(normalizeState),
};

/** Is the CLI on PATH? `--version` is the cheapest question every one answers; a desktop row asks its own way. */
async function present(hvOrBin) {
  if (typeof hvOrBin === 'object' && hvOrBin.present) return hvOrBin.present().catch(() => false);
  try { await run(typeof hvOrBin === 'object' ? hvOrBin.bin : hvOrBin, ['--version']); return true; } catch { return false; }
}

/**
 * GET /api/vms (and the machines' rows, machines/vm-list.js)
 *
 * Reports every hypervisor separately, each with its own error, so one broken
 * connection (a libvirtd the user cannot reach) does not hide the other's VMs.
 */
async function listAll() {
  // A hypervisor that cannot exist on this OS (Hyper-V off Windows, UTM off a Mac) is left out, not reported missing.
  return Promise.all(Object.entries(HYPERVISORS).filter(([, hv]) => !hv.os || hv.os.includes(process.platform)).map(async ([id, hv]) => {
    if (!await present(hv))
      return { id, label: hv.label, bin: hv.bin, available: false, vms: [], error: `${hv.bin} not found` };
    try {
      return { id, label: hv.label, bin: hv.bin, available: true, vms: await hv.list(), error: null };
    } catch (e) {
      return { id, label: hv.label, bin: hv.bin, available: true, vms: [], error: e.stderr?.trim() || e.message };
    }
  }));
}

async function handleList(_req, res) {
  // Each running VM says whether its console opens through the hub (machines/vm-console.js), as it does in Live.
  const { where } = require('./machines/vm-console');
  const hypervisors = (await listAll()).map(hv => ({ ...hv, vms: hv.vms.map(vm => ({ ...vm, console: where({ ...vm, hypervisor: hv.id }) })) }));
  res.json({ hypervisors, libvirtUri: libvirtUri() });
}

/** POST /api/vms/:hypervisor/action — { name, action } */
async function handleAction(req, res) {
  const hv     = HYPERVISORS[req.params.hypervisor];
  const { name, action } = req.body || {};
  if (!hv)               return res.status(404).json({ error: 'Unknown hypervisor' });
  if (!hv.actions[action]) return res.status(400).json({ error: `Unknown action "${action}"` });
  if (!name)             return res.status(400).json({ error: 'name required' });

  try {
    // Only a machine that exists can be named, so nothing else reaches argv.
    const known = (await hv.list()).some(vm => vm.name === name);
    if (!known) return res.status(404).json({ error: `No such VM: ${name}` });

    const out = hv.act ? await hv.act(action, name) : await run(hv.bin, [...hv.flags(), ...hv.actions[action](name)]);
    res.json({ ok: true, output: out.trim() || `${action} sent to ${name}` });
  } catch (e) {
    res.status(500).json({ error: e.stderr?.trim() || e.message });
  }
}

/**
 * POST /api/vms/settings — { libvirtUri }
 *
 * virsh talks to `qemu:///session` by default, while machines made with
 * virt-manager as root live in `qemu:///system`. Getting an empty list is
 * almost always this, so the URI is settable rather than assumed.
 */
function handleSettings(req, res) {
  const uri = typeof req.body?.libvirtUri === 'string' ? req.body.libvirtUri.trim() : null;
  if (uri === null) return res.status(400).json({ error: 'libvirtUri required' });
  try {
    const prefs = loadPrefs();
    prefs[PREFS_KEY] = { ...prefs[PREFS_KEY], libvirtUri: uri };
    savePrefs(prefs);
    res.json({ ok: true, libvirtUri: uri });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

function mount(app) {
  require('./vms-manage').mount(app);   // before /:hypervisor/action, which it does not overlap, but reads first
  app.get ('/api/vms',                    handleList);
  app.post('/api/vms/settings',           handleSettings);
  app.post('/api/vms/:hypervisor/action', handleAction);
}

module.exports = {
  mount,
  handleList,
  handleAction,
  handleSettings,
  listAll,
  virshFlags,
  // exported for tests
  parseVirshList,
  parseVboxList,
  parseVboxDisplay,
  normalizeState,
};
