'use strict';

/**
 * What is using a machine right now (asked 2026-10-08: "add a confirmation when a machine or a docker container's (and
 * so on) closing button is pressed by the user, so we do not close a service in use"). Every button in the panel that
 * stops, restarts, kills or removes one asks first (public/js/lib/machine-ask.js), and the question names what would
 * be cut off — found here, from what already exists:
 *   service    an inference service (services.js): what uses its port (use-ports.js — a provider, the hive's voice and
 *              the screens speaking with it, its speech-to-text, DOCA's requests in flight, a served page)
 *   llamacpp   a llama.cpp server this panel runs: what uses its port — the agent's model, say
 *   container  its published ports; a service's own container (doca-<id>) and the stack's say so
 *   computer   the running mission it is lent to, a person driving it, an agent's last act on it, a page it serves
 *   vm         its consoles open through the hub, a VNC screen of it being watched or lent to a running mission
 *   vnc        people watching or driving it, the running mission it is lent to
 *   stack      the containers that run in it, and what uses theirs
 *   mcp        the conversations working now (each holds a running server's tools) and its last call
 * `machineUse(kind, id)` → { kind, id, name, reasons: [sentences] }: no reasons means nothing DOCA can see uses it.
 * `GET /api/machines/use?kind=&id=` is the panel's way to it (host, with the rest of /api/machines).
 */
const ports = require('./use-ports');

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const WORKING_MS = 45000;

/** A running mission that has this computer or VNC screen lent to it, if any. */
function missionHolding({ computer = null, vnc = null }) {
  try {
    const memory = require('../harness/memory');
    return require('../agents/missions').running().find(m => {
      const p = memory.getSession(m.sessionId)?.profile || {};
      return (computer && p.computer === computer) || (vnc && p.vnc === vnc);
    }) || null;
  } catch { return null; }
}

function stackProject() {
  try { return require('path').basename(require('../paths').COMPOSE_DIR).toLowerCase().replace(/[^a-z0-9_-]/g, ''); } catch { return 'stack'; }
}
const projectOf = c => /(?:^|,)com\.docker\.compose\.project=([^,]+)/.exec(String(c.Labels || ''))?.[1] || null;

async function containers() {
  try { return await require('../containers').ps({ all: true }); } catch { return []; }
}

const KIND = {
  async service(id) {
    const s = require('../services').INFERENCE_SERVICES.find(x => x.id === id);
    if (!s) return null;
    return { name: s.label || s.id, reasons: ports.reasons(s.port, s.label || s.id) };
  },
  async llamacpp(id) {
    const inst = require('../models-llamacpp').loadInstances().find(i => i.id === id);
    if (!inst) return null;
    return { name: inst.name || inst.id, reasons: ports.reasons(Number(inst.port), `the llama.cpp server ${inst.name || inst.id}`) };
  },
  async container(id) {
    const c = (await containers()).find(x => x.ID === id || String(x.ID || '').startsWith(id) || String(x.Names || '').split(',').includes(id));
    if (!c) return null;
    const name = String(c.Names || '').split(',')[0];
    const reasons = [];
    const svc = /^doca-(.+)$/.exec(name)?.[1];
    const service = svc && require('../services').INFERENCE_SERVICES.find(s => s.id === svc);
    if (service) reasons.push(`it is the inference service ${service.label || service.id}`);
    const project = projectOf(c);
    if (project && project === stackProject()) reasons.push('it is part of the stack (Settings → OpenClaw → Stack)');
    if (String(c.State).toLowerCase() === 'running') for (const p of ports.published(c.Ports)) reasons.push(...ports.reasons(p, service?.label || name));
    return { name, reasons: [...new Set(reasons)] };
  },
  async computer(id) {
    const computers = require('../computers');
    const c = computers.get(id);
    if (!c) return null;
    const reasons = [];
    const m = missionHolding({ computer: id });
    if (m) reasons.push(`it is lent to the running mission ${m.label || m.agentId} (${m.agentId})`);
    if (require('../computers/vnc').driving(id)) reasons.push('someone has taken it over and is driving it now');
    const act = require('./index').actOf(id);
    if (act && Date.now() - act.at < WORKING_MS) reasons.push(`an agent used it ${Math.round((Date.now() - act.at) / 1000)} s ago (${act.what})`);
    if (c.by && require('../harness/turn/lifecycle').isRunning(c.by)) reasons.push(`the conversation that made it, ${require('../harness/memory').getSession(c.by)?.title || c.by}, is working now`);
    try {
      const pages = await require('./index').computerPages([{ ...c, state: 'running', serve: { port: c.servePort, inside: computers.SERVE } }].filter(x => x.serve.port));
      if (pages.length) reasons.push(`it serves a page on port ${computers.SERVE} (${pages[0].url})`);
    } catch { /* not answering */ }
    return { name: c.name || id, reasons };
  },
  async vm(id) {
    const [hv, ...rest] = String(id).split(':'), name = rest.join(':');
    const vm = await require('./vm-list').find(hv, name);
    if (!vm) return null;
    const reasons = [];
    const open = require('./vm-console').consoles(`${hv}:${name}`);
    if (open) reasons.push(`${plural(open, 'console is', 'consoles are')} open on it through the hub`);
    try {
      const { targets } = await require('../vnc-targets').detailed({ vms: [vm], computers: [] });
      for (const t of targets.filter(x => x.same?.kind === 'vm' && x.same.id === id)) reasons.push(...vncReasons(t.id, `its VNC screen ${t.name}`));
    } catch { /* no targets */ }
    return { name: vm.name, reasons };
  },
  async vnc(id) {
    const t = require('../vnc-targets/store').find(id);
    return t ? { name: t.name, reasons: vncReasons(t.id, t.name) } : null;
  },
  async stack() {
    const project = stackProject();
    const mine = (await containers()).filter(c => projectOf(c) === project && String(c.State).toLowerCase() === 'running');
    const reasons = mine.length ? [`${plural(mine.length, 'container runs', 'containers run')} in it: ${mine.map(c => String(c.Names).split(',')[0]).join(', ')}`] : [];
    for (const c of mine) for (const p of ports.published(c.Ports)) reasons.push(...ports.reasons(p, String(c.Names).split(',')[0]));
    return { name: 'the stack', reasons: [...new Set(reasons)] };
  },
  async mcp(id) {
    const s = require('../mcp/registry').list().find(x => x.id === id);
    if (!s) return null;
    const reasons = [];
    if (s.state === 'running') {
      const working = require('../harness/turn/lifecycle').running.size;
      if (working) reasons.push(`${plural(working, 'conversation is', 'conversations are')} working now with its ${plural(s.toolCount || 0, 'tool')} in hand`);
      const last = require('./index').mcpCallOf(require('../mcp/registry').slug(id));
      if (last && Date.now() - last.at < 10 * 60000) reasons.push(`an agent called one of its tools ${ago(Date.now() - last.at)}${last.sessionId ? ` in ${require('../harness/memory').getSession(last.sessionId)?.title || 'a conversation'}` : ''}`);
    }
    return { name: s.label || s.name || id, reasons };
  },
};

function vncReasons(id, name) {
  const out = [];
  const s = require('../vnc-targets/state').sockets(id);
  if (s.driving) out.push(`${plural(s.driving, 'person is', 'people are')} driving ${name} now`);
  if (s.watching) out.push(`${plural(s.watching, 'person is', 'people are')} watching ${name}`);
  const m = missionHolding({ vnc: id });
  if (m) out.push(`${name} is lent to the running mission ${m.label || m.agentId} (${m.agentId})`);
  return out;
}

const ago = ms => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} s ago` : `${Math.round(ms / 60000)} min ago`);

/** What uses this machine now: { kind, id, name, reasons }. An unknown machine has no reasons and `missing: true`. */
async function machineUse(kind, id) {
  const read = KIND[kind];
  if (!read) throw Object.assign(new Error(`No kind of machine "${kind}": ${Object.keys(KIND).join(', ')}.`), { status: 400 });
  let got = null;
  try { got = await read(String(id || '')); } catch { got = null; }
  return got ? { kind, id: String(id || ''), name: got.name, reasons: got.reasons } : { kind, id: String(id || ''), name: String(id || ''), reasons: [], missing: true };
}

function mount(app) {
  app.get('/api/machines/use', async (req, res) => {
    try { res.json(await machineUse(String(req.query.kind || ''), String(req.query.id || ''))); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { machineUse, mount, stackProject, projectOf, KINDS: Object.keys(KIND) };
