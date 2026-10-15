'use strict';

/**
 * Every VM on this host for Machines → Live's "VMs" switch (asked 2026-10-15: "I was expecting it to be in a VM on the
 * machine and to be able to see it … if it has a password we could have the black screen with a lock and just show
 * resources used live and basic info"; licence feature `machines-all`, like the Processes button). `GET
 * /api/machines/vms/all` (host, with the rest of /api/machines) adds to what Live already shows:
 *   every VM, running or not — its state, OS, what it is given (vm-facts.js), its CPU and memory in use now (busy.js
 *   while a page looks, Hyper-V's own Get-VM), how long it has run, who started or stopped it (origin.js) and when it
 *   last ran if known; a running one says whether Live has its picture (vm-shots.js, which picture() keeps asking for),
 *   and when it cannot — its hypervisor gives none, or taking it failed — that the tile is a lock with its readings
 *   the VNC targets that do not answer, and those that need a password DOCA does not hold — with what is known
 * Nothing is guessed: no password is tried, no model is asked; readings in fixed words.
 */
const facts = require('./vm-facts');

const LOCKED_VNC = /password|security type|refused/i;
/** Whether a VNC picture's failure is a locked door (a password, a security type DOCA does not speak) rather than a fault. */
const lockedWhy = why => !!why && LOCKED_VNC.test(why);

/** The action that brings it up through POST /api/vms/:hypervisor/action: a stopped one starts, a paused one resumes (Hyper-V's Saved starts). */
const startOf = v => (v.state === 'stopped' ? 'start' : v.state === 'paused' ? (/saved/i.test(v.stateRaw || '') ? 'start' : 'resume') : null);

/** One VM as Live's every-VM view draws it. */
function view(v, { now = Date.now(), seen = () => null } = {}) {
  const shots = require('./vm-shots'), key = shots.keyOf(v), busy = require('./busy').of('vm', key);
  const running = v.state === 'running';
  const cannot = running ? shots.cannot(v) : null, failed = running ? shots.error(key) : null, shot = running && shots.has(key);
  // busy.js's share is of one core (CPU time between two looks); Hyper-V's CPUUsage is of all its processors.
  const live = busy?.cpu != null ? { cpu: busy.cpu, cpuOf: 'core' } : { cpu: v.live?.cpu ?? null, cpuOf: 'all' };
  live.memUsedKiB = busy?.memKiB ?? v.live?.memUsedKiB ?? null;
  const origin = require('./origin');
  const stopped = running ? null : origin.of('vm', key, { up: false });
  const lastRan = running ? null : Math.max(v.stoppedAt || 0, seen(key) || 0, stopped?.at ? Date.parse(stopped.at) : 0) || null;
  return { key, name: v.name, hypervisor: v.hypervisor, label: v.label, os: v.os || null, state: v.state,
    shot, locked: running && !shot && !!(cannot || failed), why: cannot || failed || null,
    console: running ? require('./vm-console').where(v) : null, busy: busy?.busy ? { busy: true, text: busy.text, who: busy.who } : null,
    given: v.given || null, live: running ? live : null, startedAt: running ? v.startedAt || null : null,
    uptimeMs: running && v.startedAt ? Math.max(0, now - v.startedAt) : null, lastRan,
    reads: facts.reads(v.hypervisor), origin: running ? origin.of('vm', key, { up: true }) : stopped, start: startOf(v) };
}

/** The VNC targets Live does not picture: unreachable, or locked behind a password DOCA does not hold. */
async function vncLocked() {
  const store = require('../vnc-targets/store'), state = require('../vnc-targets/state'), shots = require('../vnc-targets/shots');
  return (await Promise.all(store.list().map(async t => {
    const st = await state.stateOf(t), why = shots.error(t.id);
    if (st === 'unreachable') return { id: t.id, name: t.name, host: t.host, port: t.port, state: st, hasPassword: t.hasPassword, why: 'It does not answer.' };
    if (lockedWhy(why)) return { id: t.id, name: t.name, host: t.host, port: t.port, state: st, hasPassword: t.hasPassword, why };
    return null;
  }))).filter(Boolean);
}

async function all({ fresh = false } = {}) {
  require('./busy').want();   // shown, so looked at: live CPU and memory while the page asks
  const { vms, hypervisors } = await require('./vm-list').list({ fresh });
  const seen = facts.lastSeen(vms), now = Date.now();
  const order = { running: 0, paused: 1 };
  return { vms: vms.map(v => view(v, { now, seen })).sort((a, b) => (order[a.state] ?? 2) - (order[b.state] ?? 2) || a.name.localeCompare(b.name)),
    vnc: await vncLocked().catch(() => []), hypervisors: hypervisors || [] };
}

function mount(app) {
  app.get('/api/machines/vms/all', async (req, res) => { try { res.json(await all({ fresh: req.query.fresh === '1' })); } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { mount, all, view, lockedWhy };
