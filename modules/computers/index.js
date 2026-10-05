'use strict';

/**
 * Computers for agents (docs/design/hive.md §3.2; TODO H7.2, asked 2026-10-04):
 * a Linux desktop in a container per job — files, a shell, a screen, a real
 * Chromium, screen recording — which a specialist uses to test something risky
 * in a real environment, or to record a demo, without touching this host.
 *
 * A computer is a client of the hive: its control server (clients/computer)
 * is an MCP server, registered here as `computer-<id>`, so its tools reach the
 * agent through the same layer as every other tool (`mcp__computer-<id>__…`),
 * under the same approvals and levels. Docker runs it on Linux, Windows and
 * macOS hosts alike; a VM backend (another OS, a kernel) is the next step.
 *
 * Ports are bound to 127.0.0.1 only; the control server needs a token the hub
 * made, and VNC a password the hub made. The home folder is a named volume, so
 * a stopped computer keeps its files until it is removed.
 */
const crypto = require('crypto');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');
const store = require('../store');

const IMAGE = 'doca/computer:1';
const CONTEXT = path.join(__dirname, '..', '..', 'clients', 'computer');
const DOC = 'computers';
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

function docker(args, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(require('../containers').cli(), args, { timeout, maxBuffer: 8 << 20, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(new Error(String(stderr || err.message).trim().split('\n').pop()), { status: 500 }));
      resolve(String(stdout).trim());
    });
  });
}

const rows = () => store.readJson(DOC, { computers: [] }).computers;
const save = list => store.writeJson(DOC, { computers: list });
const get = id => rows().find(c => c.id === id) || null;
const all = () => rows();
/** The computers a conversation made: a work chat works in these directly (turn/prompt.js disabledFor). */
const madeBy = sessionId => rows().filter(c => c.by === sessionId).map(c => c.id);
const need = id => get(String(id)) || (() => { throw bad(`No computer ${id}. Make one with the computer tool first.`, 404); })();
const container = c => `doca-computer-${c.id}`;
const serverId = c => `computer-${c.id}`;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

async function imageReady() { try { await docker(['image', 'inspect', IMAGE]); return true; } catch { return false; } }

/** Build the image from clients/computer (minutes the first time: Chromium, a desktop, ffmpeg). */
function build(onLine = () => {}) {
  return new Promise((resolve, reject) => {
    const child = require('child_process').spawn(require('../containers').cli(), ['build', '-t', IMAGE, CONTEXT], { windowsHide: true });
    const feed = d => String(d).split('\n').filter(Boolean).forEach(onLine);
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    child.on('close', code => (code === 0 ? resolve({ image: IMAGE }) : reject(bad(`docker build exited ${code}`, 500))));
    child.on('error', e => reject(bad(`docker is not available: ${e.message}`, 424)));
  });
}

/** Register the computer's control server with the MCP layer, and connect once it answers. */
async function connect(c) {
  const registry = require('../mcp/registry');
  registry.upsert({ id: serverId(c), label: `Computer: ${c.name}`, transport: 'http', url: `http://127.0.0.1:${c.mcpPort}/mcp`,
    headers: { Authorization: `Bearer ${c.token}` }, autostart: false });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${c.mcpPort}/health`)).ok) break; } catch { /* still starting */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return registry.start(serverId(c));
}

/** `auto`: an agent made it, so it is tidied away after it stops (lifecycle.js) unless a person pins it. */
async function create({ name, purpose = '', missionId = null, by = null, auto = false, agentType = null } = {}) {
  if (!(await imageReady())) throw bad('The computer image is not built yet: build it once (Computers → Build the image).', 409);
  await require('./lifecycle').roomForOne();
  const c = { id: crypto.randomBytes(4).toString('hex'), name: String(name || 'computer').replace(/[^\w .-]/g, '').slice(0, 40) || 'computer',
    purpose: String(purpose).slice(0, 300), missionId, by, auto: !!auto, pinned: false, ...(agentType ? { agentType } : {}), token: crypto.randomBytes(24).toString('hex'),
    vncPassword: crypto.randomBytes(6).toString('hex'), mcpPort: await freePort(), vncPort: await freePort(), createdAt: new Date().toISOString() };
  await docker(['run', '-d', '--name', container(c), '--shm-size=1g', '--label', 'doca.computer=1',
    '-p', `127.0.0.1:${c.mcpPort}:8765`, '-p', `127.0.0.1:${c.vncPort}:6080`,
    '-e', `TOKEN=${c.token}`, '-e', `VNC_PASSWORD=${c.vncPassword}`,
    '-v', `${container(c)}:/home/agent`, IMAGE]);
  save([...rows(), c]);
  await connect(c);
  return view(c);
}

const patch = (id, fields) => save(rows().map(x => (x.id === id ? { ...x, ...fields } : x)));

async function start(id) {
  const c = need(id);
  if (!(await list()).some(x => x.id === c.id && x.state === 'running')) await require('./lifecycle').roomForOne();
  await docker(['start', container(c)]);
  patch(c.id, { stoppedAt: null });
  await connect(c);
  return view(c);
}

async function stop(id) {
  const c = need(id);
  try { require('../mcp/registry').stop(serverId(c)); } catch { /* not connected */ }
  await docker(['stop', '-t', '5', container(c)]).catch(() => {});
  patch(c.id, { stoppedAt: new Date().toISOString() });
  return view(c);
}

/** Kept until a person unpins it: never stopped when its mission ends, never tidied away (lifecycle.js). */
function pin(id, pinned = true) {
  const c = need(id);
  patch(c.id, { pinned: !!pinned });
  return view({ ...c, pinned: !!pinned });
}

async function remove(id) {
  const c = need(id);
  try { require('../mcp/registry').remove(serverId(c)); } catch { /* never registered */ }
  await docker(['rm', '-f', container(c)]).catch(() => {});
  await docker(['volume', 'rm', '-f', container(c)]).catch(() => {});
  save(rows().filter(x => x.id !== id));
  return { removed: id };
}

/** What the panel and the agent see: never the token. The VNC password is for the person who opens the view. */
function view(c, state = null) {
  return { id: c.id, name: c.name, purpose: c.purpose, missionId: c.missionId, createdAt: c.createdAt, state,
    auto: !!c.auto, pinned: !!c.pinned, stoppedAt: c.stoppedAt || null, by: c.by || null, agentType: c.agentType || null,
    server: serverId(c), tools: `mcp__${serverId(c)}__*`,
    // Through the hub, so any signed-in host's browser can watch — the phone on the tailnet included (vnc.js).
    vnc: { url: require('./vnc').watchUrl(c), drive: require('./vnc').driveUrl(c), local: `http://127.0.0.1:${c.vncPort}/vnc.html`, password: c.vncPassword },
    driving: require('./vnc').driving(c.id) };
}

/** A mission is lent this computer (agents/missions dispatch): remembered, so the view can say who works in it. */
/**
 * The computer a specialist type keeps (a definition with `computer: own`, TODO H13.3): made the first time and the
 * same one every mission after — its browser profile, logins and files are where the last mission left them. It is
 * not `auto`, so the sweep never removes it; it stops when idle like any other and starts again when lent. Removing
 * it by hand gives the next mission a fresh one.
 */
async function ownFor(def) {
  const have = rows().find(c => c.agentType === def.id);
  if (have) return have.id;
  return (await module.exports.create({ name: `${def.label}'s computer`.slice(0, 40), purpose: `Kept for ${def.label}: the same desktop, logins and files every mission.`, agentType: def.id })).id;
}

function lend(id, missionId) {
  const c = need(id);
  patch(c.id, { missionId, missions: [...(c.missions || []), missionId].slice(-20) });
  list().then(l => { if (l.find(x => x.id === c.id)?.state !== 'running') start(c.id).catch(() => {}); });   // stopped since its last errand
  return c.id;
}

/** Its screen now, as PNG bytes — the control server's own screenshot tool, asked directly so nothing is kept. */
const _screens = new Map();
async function screen(id) {
  const c = need(id);
  const hit = _screens.get(c.id);
  if (hit && Date.now() - hit.at < 2000) return hit.png;   // one capture for every viewer of the same moment
  const r = await fetch(`http://127.0.0.1:${c.mcpPort}/mcp`, { method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'screenshot', arguments: {} } }) })
    .then(x => x.json()).catch(() => null);
  const img = r?.result?.content?.find(x => x.type === 'image');
  if (!img) throw bad('The computer is not answering — is it running?', 502);
  const png = Buffer.from(img.data, 'base64');
  _screens.set(c.id, { at: Date.now(), png });
  return png;
}

/** For the Computers view: who works in each (the mission) and what it produced (kept MCP pictures and files). */
async function detailed() {
  const missions = require('../agents/missions');
  const files = require('../attachments').list({ limit: 1000 });
  return (await list()).map(v => {
    const m = v.missionId ? missions.get(v.missionId) : null;
    return { ...v, mission: m && { id: m.id, agentId: m.agentId, label: m.label, state: m.state, task: String(m.task || '').slice(0, 200) },
      media: files.filter(f => f.from === `mcp:${v.server}`).slice(0, 12).map(({ name, mime, bytes, at }) => ({ name, mime, bytes, at })) };
  });
}

/**
 * Files between a computer and the attachments (TODO H13.3), by `docker cp`: put an attachment into the
 * computer's work folder, or keep a file from the computer as an attachment (show it, read it, send it on).
 */
const WORK = '/home/agent/work';
async function put(id, attachmentName, dest = '') {
  const c = need(id);
  const a = require('../attachments').get(attachmentName);
  if (!a) throw bad(`No attachment "${attachmentName}".`, 404);
  const rel = String(dest || a.name).replace(/^\/+/, '');
  if (rel.split('/').includes('..')) throw bad('The destination stays inside the work folder.');
  const target = require('path').posix.join(WORK, rel.endsWith('/') ? `${rel}${a.name}` : rel);
  await docker(['exec', container(c), 'mkdir', '-p', require('path').posix.dirname(target)]);
  await docker(['cp', a.path, `${container(c)}:${target}`]);
  await docker(['exec', '-u', '0', container(c), 'chown', 'agent:agent', target]).catch(() => {});
  return { path: target, bytes: a.bytes };
}

async function fetchFile(id, src) {
  const c = need(id);
  const from = String(src || '').startsWith('/') ? String(src) : require('path').posix.join(WORK, String(src || ''));
  const fs = require('fs'), os = require('os'), path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-cp-'));
  try {
    const local = path.join(tmp, path.posix.basename(from) || 'file');
    await docker(['cp', `${container(c)}:${from}`, local]);
    if (!fs.statSync(local).isFile()) throw bad(`${from} is a folder; name a file.`);
    return require('../attachments').save(fs.readFileSync(local), path.basename(local), { from: `mcp:${serverId(c)}` });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function list() {
  let states = {};
  try {
    const out = await docker(['ps', '-a', '--filter', 'label=doca.computer=1', '--format', '{{.Names}}\t{{.State}}']);
    states = Object.fromEntries(out.split('\n').filter(Boolean).map(l => l.split('\t')));
  } catch { /* docker absent: states unknown */ }
  return rows().map(c => view(c, states[container(c)] || 'missing'));
}

module.exports = { IMAGE, imageReady, build, create, start, stop, remove, pin, list, detailed, screen, lend, ownFor, get, all, madeBy, need, put, fetchFile };
