'use strict';

/**
 * The desktop hypervisors beside libvirt and VirtualBox (TODO H1.7; hive.md §7): Hyper-V on Windows, UTM and
 * Parallels on macOS. Same shape as vms.js's rows — list, actions, a display when there is one — so the VMs
 * tab and the agent see one list whatever the host.
 *
 *   Hyper-V    PowerShell's Hyper-V module (Get-VM …); the VM's name reaches it through an environment
 *              variable, never spliced into the command text. Needs the Hyper-V Administrators group.
 *   UTM        utmctl (UTM 4+)
 *   Parallels  prlctl
 */
const { execFile } = require('child_process');

function run(bin, args, env = {}) {
  return new Promise((resolve, reject) => execFile(bin, args, { env: { ...process.env, LC_ALL: 'C', LANG: 'C', ...env }, timeout: 30000, maxBuffer: 4 << 20, windowsHide: true },
    (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(String(stdout)))));
}
const ps = (script, env) => run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], env);

/* ── Hyper-V ── */
/** Get-VM's JSON: one object, or a list; State is a name (or its number in old PowerShell). */
const HYPERV_STATES = { 2: 'Running', 3: 'Off', 6: 'Saved', 9: 'Paused' };
function parseHyperV(json) {
  if (!String(json || '').trim()) return [];
  return [].concat(JSON.parse(json)).filter(Boolean).map(v => {
    const raw = typeof v.State === 'number' ? (HYPERV_STATES[v.State] || String(v.State)) : String(v.State || '');
    return { name: v.Name, id: v.Id?.Guid || v.Id || null, hypervisor: 'hyperv', stateRaw: raw, display: null };
  });
}
const HYPERV_ACTIONS = {
  start: 'Start-VM -Name $env:DOCA_VM', stop: 'Stop-VM -Name $env:DOCA_VM', kill: 'Stop-VM -Name $env:DOCA_VM -TurnOff -Force',
  reboot: 'Restart-VM -Name $env:DOCA_VM -Force', resume: 'Resume-VM -Name $env:DOCA_VM',
};

/* ── UTM ── */
/** `utmctl list`: a header, then UUID, status, name (a name may hold spaces). */
function parseUtm(text) {
  return String(text || '').split('\n').slice(1).map(l => /^([0-9A-F-]{36})\s+(\S+)\s+(.+?)\s*$/i.exec(l)).filter(Boolean)
    .map(([, id, status, name]) => ({ name, id, hypervisor: 'utm', stateRaw: status, display: null }));
}
const UTM_ACTIONS = { start: n => ['start', n], stop: n => ['stop', '--request', n], kill: n => ['stop', '--force', n], resume: n => ['start', n], pause: n => ['suspend', n] };

/* ── Parallels ── */
/** `prlctl list --all --json`: [{uuid, status, name, …}]. */
function parseParallels(json) {
  if (!String(json || '').trim()) return [];
  return JSON.parse(json).map(v => ({ name: v.name, id: v.uuid, hypervisor: 'parallels', stateRaw: v.status, display: null }));
}
const PRL_ACTIONS = { start: n => ['start', n], stop: n => ['stop', n], kill: n => ['stop', n, '--kill'], reboot: n => ['reset', n], resume: n => ['resume', n], pause: n => ['pause', n] };

const which = b => !!require('./shell').which(b);

/** Rows for vms.js's HYPERVISORS: `present`, `list`, `act(action, name)` (each owning how it is invoked), and the OS it exists on. */
function hypervisors(normalizeState) {
  const tag = list => list.map(v => ({ ...v, state: normalizeState(v.stateRaw) }));
  return {
    hyperv: { label: 'Hyper-V', bin: 'powershell (Hyper-V)', actions: HYPERV_ACTIONS, os: ['win32'],
      present: async () => process.platform === 'win32' && (await ps('if (Get-Command Get-VM -ErrorAction SilentlyContinue) { "yes" }').catch(() => '')).trim() === 'yes',
      list: async () => tag(parseHyperV(await ps('Get-VM | Select-Object Name,State,Id | ConvertTo-Json -Compress'))),
      act: (action, name) => ps(HYPERV_ACTIONS[action], { DOCA_VM: name }) },
    utm: { label: 'UTM', bin: 'utmctl', actions: UTM_ACTIONS, os: ['darwin'],
      present: async () => process.platform === 'darwin' && which('utmctl'),
      list: async () => tag(parseUtm(await run('utmctl', ['list']))),
      act: (action, name) => run('utmctl', UTM_ACTIONS[action](name)) },
    parallels: { label: 'Parallels', bin: 'prlctl', actions: PRL_ACTIONS, os: ['darwin'],
      present: async () => which('prlctl'),
      list: async () => tag(parseParallels(await run('prlctl', ['list', '--all', '--json']))),
      act: (action, name) => run('prlctl', PRL_ACTIONS[action](name)) },
  };
}

module.exports = { hypervisors, parseHyperV, parseUtm, parseParallels };
