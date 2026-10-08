'use strict';

/**
 * Every machine on this hub in one shape (asked 2026-10-08: "show running VMs and computers on the side status column
 * as we do with containers, as well as in Live … all coherently"): containers, the agents' computers and the virtual
 * machines, each a row
 *   { kind: container|computer|vm, id, name, state, point: up|paused|down|error, detail, tab, actions, live }
 * drawn the same way by the status column and Machines → Live, made from the readers that already exist —
 * containers.ps(), computers.detailed(), vm-list (vms.js's list, kept a few seconds). A computer's own container is
 * a computer, not a container too. The rows are kept TTL_MS, so the status column polling every few seconds runs
 * docker at most that often and a hypervisor CLI at most every vm-list.TTL_MS.
 *   point   up breathes, down is dim, error is red — the Points skin's point, a bar's colour in Classic
 *   tab     the page that manages it (docker, computers, vms)
 *   live    it has a picture in Machines → Live (a running computer, a running VM whose hypervisor gives one)
 */
const TTL_MS = 4000;
let _cache = null, _pending = null;

function containerRow(c) {
  const state = String(c.State || '').toLowerCase() || (/^up\b/i.test(c.Status || '') ? 'running' : 'exited');
  const code = /exited \((\d+)\)/i.exec(c.Status || '')?.[1];
  const point = state === 'running' ? 'up' : state === 'paused' ? 'paused'
    : state === 'restarting' || state === 'dead' || (state === 'exited' && code && code !== '0' && code !== '137' && code !== '143') ? 'error' : 'down';
  return { kind: 'container', id: c.ID || c.Id || c.Names, name: String(c.Names || c.Name || '').replace(/^\//, '').split(',')[0],
    state, point, detail: [c.Image, c.Status].filter(Boolean).join(' · '), tab: 'docker',
    actions: state === 'running' ? ['stop', 'restart'] : ['start'], live: false };
}

function computerRow(c) {
  const point = c.state === 'running' ? 'up' : c.state === 'paused' ? 'paused' : c.state === 'missing' || c.state === 'dead' || c.state === 'restarting' ? 'error' : 'down';
  const detail = c.mission ? `${c.mission.label || c.mission.agentId} · ${c.mission.state}` : c.agentType ? `kept for ${c.agentType}` : c.purpose || 'no mission yet';
  return { kind: 'computer', id: c.id, name: c.name, state: c.state, point, detail, tab: 'computers',
    actions: c.state === 'running' ? ['open', 'stop'] : ['start'], live: c.state === 'running' };
}

function vmRow(v) {
  const shots = require('./vm-shots');
  const point = v.state === 'running' ? 'up' : v.state === 'paused' ? 'paused' : v.state === 'stopped' ? 'down' : /crash|abort|unknown|stuck|invalid/.test(v.state) ? 'error' : 'down';
  const at = require('./vm-console').where(v);
  return { kind: 'vm', id: shots.keyOf(v), name: v.name, state: v.state, point, hypervisor: v.hypervisor,
    detail: [v.label, v.os].filter(Boolean).join(' · '), tab: 'vms',
    actions: v.state === 'running' ? [...(at.how === 'hub' ? ['open'] : []), 'stop'] : v.state === 'paused' ? ['resume'] : ['start'],
    live: v.state === 'running' };
}

const isComputer = c => /(^|,)doca\.computer=1(,|$)/.test(String(c.Labels || ''));

async function read() {
  const [containers, computers, vms] = await Promise.all([
    require('../containers').ps({ all: true }).then(list => ({ list }), e => ({ list: [], error: e.message.split('\n')[0] })),
    require('../computers').detailed().then(list => ({ list }), e => ({ list: [], error: e.message })),
    require('./vm-list').list(),
  ]);
  const rows = [
    ...containers.list.filter(c => !isComputer(c)).map(containerRow),
    ...computers.list.map(computerRow),
    ...vms.vms.map(vmRow),
  ];
  const count = kind => {
    const of = rows.filter(r => r.kind === kind);
    return { total: of.length, running: of.filter(r => r.point === 'up').length, stopped: of.filter(r => r.point === 'down').length };
  };
  return { at: Date.now(), rows, counts: { container: count('container'), computer: count('computer'), vm: count('vm') },
    errors: { container: containers.error || null, computer: computers.error || null } };
}

/** Every machine as a row, at most TTL_MS old. `fresh` reads again (after an action changed one). */
function rows({ fresh = false } = {}) {
  if (!fresh && _cache && Date.now() - _cache.at < TTL_MS) return Promise.resolve(_cache);
  if (_pending) return _pending;
  _pending = read().then(r => (_cache = r)).finally(() => { _pending = null; });
  return _pending;
}

module.exports = { rows, containerRow, computerRow, vmRow, TTL_MS, _reset: () => { _cache = null; } };
