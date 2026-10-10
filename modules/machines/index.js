'use strict';

/**
 * Machines → Live (TODO H10.9; asked 2026-10-06: "a page where we see the machines of the agents live and the ones
 * working get highlighted on the foreground, not just the machines but all the panels where the agent is serving the
 * pages for the tests"). One picture of where the agents are working:
 *   computers  the agents' computers with what each did last and when (from agent.events: any of its tools, by the
 *              `mcp__computer-<id>__` name, or a tool naming it), and whether a running mission holds it
 *   served     the pages the agents serve for tests: an address a running job printed (a dev server's "Local:
 *              http://localhost:5173"), on this machine only — loopback, 0.0.0.0, this host's names — seen through the
 *              hub's headless browser while a Live page looks (shots.js); and a page a running computer serves on its
 *              page port (computers SERVE, published on the hub's 127.0.0.1 — a repository run there, TODO H10.18),
 *              when something answers on it
 *   vms        the running virtual machines, each with a picture its hypervisor takes (vm-shots.js) and how its
 *              console opens (vm-console.js) — asked 2026-10-08, with the status column's rows (rows.js)
 *   vnc        the VNC targets that answer, each pictured by DOCA's own RFB client (vnc-targets/), a connected one in front
 * "Working" is anything that acted in the last WORKING_MS, or that busy.js sees busy whoever made it so (its CPU, its
 * processes: a `docker exec`, a person at its desktop); the page puts those in front.
 */
const os = require('os');

const WORKING_MS = 45000;
const _acts = new Map();   // computer id → { at, what, sessionId }
const _mcpCalls = new Map();   // MCP server slug → { at, sessionId }: what a stop would cut off (use.js)

function onEvent(evt) {
  if (evt?.type !== 'tool_call' || !evt.name) return;
  const server = /^mcp__(.+?)__/.exec(evt.name)?.[1];
  if (server) _mcpCalls.set(server, { at: Date.now(), sessionId: evt.sessionId || null });
  let args = evt.args;
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
  const m = /^mcp__computer-([\w-]+?)__(.+)$/.exec(evt.name);
  const id = m ? m[1] : (args?.computer && /^computer/.test(evt.name) ? String(args.computer) : null);
  if (!id) return;
  const what = m ? m[2].replace(/_/g, ' ') : evt.name.replace(/_/g, ' ');
  _acts.set(id, { at: Date.now(), what: `${what}${args?.url ? ` ${args.url}` : args?.text ? ` "${String(args.text).slice(0, 40)}"` : ''}`, sessionId: evt.sessionId || null });
}

const LOCAL = () => new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::]', '[::1]', '::1', os.hostname().toLowerCase(), `${os.hostname().toLowerCase()}.local`]);
const URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[\w.-]+):\d{2,5}(?:\/[^\s"'<>`)\]]*)?/g;

/** Addresses on this machine that a running job printed, newest job first. */
function served() {
  const jobs = require('../harness/jobs');
  const out = [], seen = new Set();
  for (const j of jobs.list().filter(x => x.state === 'running')) {   // newest first
    let tail = '';
    try { tail = String(jobs.output(j.id, 20000) || ''); } catch { continue; }
    tail = tail.replace(/\x1b\[[0-9;]*m/g, '');
    for (const raw of tail.match(URL_RE) || []) {
      let u;
      try { u = new URL(raw); } catch { continue; }
      if (!LOCAL().has(u.hostname.toLowerCase())) continue;
      const url = `${u.protocol}//127.0.0.1:${u.port}${u.pathname === '/' ? '/' : u.pathname}`;
      const key = `${j.id}:${u.port}`;
      if (seen.has(`${u.port}`)) continue;
      seen.add(`${u.port}`);
      out.push({ key, url, port: Number(u.port), printed: raw, jobId: j.id, command: j.command, sessionId: j.sessionId || null,
        who: j.sessionId ? (require('../harness/memory').getSession(j.sessionId)?.title || j.sessionId) : null,
        startedAt: j.startedAt || null, tail: tail.trim().split('\n').slice(-6).join('\n').slice(-800) });
    }
  }
  return out;
}

/**
 * Pages the running computers serve on their page port. Docker's port forward accepts a connection whether or not
 * anything listens inside, so only an HTTP answer counts — asked briefly, all at once.
 */
async function computerPages(computers) {
  const out = await Promise.all(computers.filter(c => c.state === 'running' && c.serve).map(async c => {
    const url = `http://127.0.0.1:${c.serve.port}/`;
    try { await fetch(url, { signal: AbortSignal.timeout(800), redirect: 'manual' }); } catch { return null; }
    return { key: `computer-${c.id}`, url, port: c.serve.port, inside: c.serve.inside, computer: c.id, printed: null, jobId: null,
      command: `in computer "${c.name}" on port ${c.serve.inside}`, sessionId: c.by || null, who: c.mission?.label || c.name, startedAt: null, tail: '' };
  }));
  return out.filter(Boolean);
}

async function picture({ shots = false } = {}) {
  const now = Date.now();
  let computers = [];
  try { computers = await require('../computers').detailed(); } catch { /* no computers */ }
  computers = computers.map(c => {
    const a = _acts.get(c.id);
    const seen = require('./busy').of('computer', c.id);   // busy whoever made it so: its CPU and processes (busy.js)
    const busy = (a && now - a.at < WORKING_MS) || c.mission?.state === 'running' || !!seen?.busy;
    const origin = require('./origin');   // who started it (origin.js), the same line as its row
    return { ...c, activity: a ? { ...a, ago: now - a.at } : null, working: !!busy, busy: seen,
      origin: origin.of('computer', c.id, { up: c.state === 'running', fallback: origin.computerFallback(c) }) };
  });
  const pages = [...served(), ...await computerPages(computers)];
  const shooter = require('./shots'), vmShooter = require('./vm-shots');
  if (shots) shooter.want(pages.map(p => ({ key: p.key, url: p.url })));
  const allVms = (await require('./vm-list').list()).vms, running = allVms.filter(v => v.state === 'running');
  // The VNC targets that answer (vnc-targets/): a target that is a running VM's display is that VM's one tile.
  const vncShooter = require('../vnc-targets/shots');
  const vnc = (await require('../vnc-targets').detailed({ vms: allVms, computers })).targets.filter(t => t.state !== 'unreachable');
  if (shots) vncShooter.want(vnc.map(t => t.id));
  const shownAsVnc = new Set(vnc.filter(t => t.same?.kind === 'vm').map(t => t.same.id));
  if (shots) vmShooter.want(running.filter(v => !shownAsVnc.has(vmShooter.keyOf(v))));
  const vms = running.filter(v => !shownAsVnc.has(vmShooter.keyOf(v))).map(v => {
    const key = vmShooter.keyOf(v);
    return { key, name: v.name, hypervisor: v.hypervisor, label: v.label, os: v.os || null, state: v.state,
      shot: vmShooter.has(key), why: vmShooter.cannot(v) || vmShooter.error(key), console: require('./vm-console').where(v), busy: require('./busy').of('vm', key),
      origin: require('./origin').of('vm', key, { up: true }) };
  });
  const { strays, emulators } = await outsideMachines({ shots, now });
  return { computers: [...computers, ...strays], served: pages.map(p => ({ ...p, shot: shooter.has(p.key), working: true })), vms, emulators,
    vnc: vnc.map(t => ({ ...t, shot: vncShooter.has(t.id), why: vncShooter.error(t.id) })), browser: shooter.browser(), workingMs: WORKING_MS };
}

/**
 * What runs on this machine that no record of this hub names (asked 2026-10-10): a computer container no record names
 * (another install's, a test hub's — stray-computers.js) as a computer tile saying so, and the Android emulators
 * (emulators.js), each pictured by a command (cmd-shots.js) — both only while a Live page asks.
 */
async function outsideMachines({ shots = false, now = Date.now() } = {}) {
  const sc = require('./stray-computers'), emu = require('./emulators'), cmd = require('./cmd-shots'), origin = require('./origin');
  const [running, e] = await Promise.all([sc.list().catch(() => []), emu.list().catch(() => ({ list: [] }))]);
  if (shots) cmd.want([...running.map(sc.source), ...(e.bin ? e.list.map(d => emu.source(d, e.bin)) : [])]);
  const P = (() => { try { return require('../branding').name('product'); } catch { return 'DOCA'; } })();
  const strays = running.map(s => {
    const key = sc.keyOf(s.name), seen = require('./busy').of('computer', s.name), a = _acts.get(s.name);
    return { id: s.name, name: s.name, state: 'running', stray: true, install: s.install, purpose: sc.detail(s), detail: sc.detail(s),
      shot: cmd.has(key), shotKey: key, why: cmd.error(key), activity: a ? { ...a, ago: now - a.at } : null, busy: seen, working: !!seen?.busy,
      origin: origin.of('computer', s.name, { up: true, fallback: s.install === 'this' ? `started by ${P} — no record names it now` : null }) };
  });
  // An emulator an agent's job started (its command names the AVD) is DOCA's; any other was started outside it.
  const jobs = (() => { try { return require('../harness/jobs').list().filter(j => j.state === 'running' && /\bemulator\b/.test(j.command || '')); } catch { return []; } })();
  const emulators = e.list.map(d => {
    const key = emu.keyOf(d.serial), job = jobs.find(j => d.name && String(j.command).includes(d.name));
    if (job) return { serial: d.serial, name: d.name, model: d.model, emulator: d.emulator, key, shot: cmd.has(key), why: cmd.error(key),
      origin: { text: `started by an agent's job${job.sessionId ? ` in the conversation "${require('../harness/memory').getSession(job.sessionId)?.title || job.sessionId}"` : ''}`, at: job.startedAt || null, by: 'agent', outside: false } };
    return { serial: d.serial, name: d.name, model: d.model, emulator: d.emulator, key, shot: cmd.has(key), why: cmd.error(key),
      origin: origin.of('emulator', d.serial, { up: true }) };
  });
  return { strays, emulators, adbWhy: e.why || null };
}

let _listening = false;
function mount(app) {
  if (!_listening) { _listening = true; require('../harness/agent').events.on('event', e => { try { onEvent(e); } catch { /* never the work's problem */ } }); }
  require('./acts-agent').listen();   // the agents' machine acts, with their conversation (acts-agent.js)
  require('./use').mount(app);         // what uses a machine, for the "are you sure" (use.js)
  require('../processes').mount(app);  // the Processes drawer: what a person started on this machine (processes/)
  // Shown, so looked at: Live and the status column keep busy.js reading the machines while they ask (nothing otherwise).
  app.get('/api/machines', async (req, res) => { require('./busy').want(); try { res.json(await picture({ shots: req.query.shots === '1' })); } catch (e) { res.status(500).json({ error: e.message }); } });
  // Every machine as one row (rows.js): the status column asks while it is shown.
  app.get('/api/machines/rows', async (req, res) => { require('./busy').want(); try { res.json(await require('./rows').rows()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/machines/vms/:hypervisor/:name/shot', (req, res) => {
    const png = require('./vm-shots').get(`${req.params.hypervisor}:${req.params.name}`);
    if (!png) return res.status(404).json({ error: 'No picture of it yet.' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).send(png);
  });
  require('./vm-console').mount(app);
  require('../vnc-targets').mount(app);   // VNC targets: /api/machines/vnc*
  app.get('/api/machines/shots/:key', (req, res) => {   // an emulator's or an unrecorded computer's picture (cmd-shots.js)
    const png = require('./cmd-shots').get(req.params.key);
    if (!png) return res.status(404).json({ error: 'No picture of it yet.' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).send(png);
  });
  app.get('/api/machines/served/:key/shot', (req, res) => {
    const png = require('./shots').get(req.params.key);
    if (!png) return res.status(404).json({ error: 'No picture of it yet.' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).send(png);
  });
}

/** What an agent last did on a computer, and when its last call to an MCP server was (use.js). */
const actOf = id => _acts.get(id) || null;
const mcpCallOf = slug => _mcpCalls.get(slug) || null;

module.exports = { mount, picture, served, computerPages, outsideMachines, onEvent, actOf, mcpCallOf, WORKING_MS };
