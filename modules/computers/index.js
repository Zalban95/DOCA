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
 * made, and VNC a password the hub made. One more port is a page's: whatever the
 * agent serves inside on SERVE (a repository it runs there, TODO H10.18) is
 * reachable on the hub at `servePort`, and so through a canvas preview from any
 * screen (canvas/previews.js) — never by a port of the computer's own choosing. The home folder is a named volume, so
 * a stopped computer keeps its files until it is removed.
 */
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');
const store = require('../store');

const IMAGE = 'doca/computer:1';
const SERVE = 8080;   // the port inside a computer whose page the person can open (a server must listen on 0.0.0.0 there)
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

/** What the image is built from (clients/computer), as a hash: a label on the image, so an older build shows. */
function sourceHash() {
  const h = crypto.createHash('sha256');
  for (const f of fs.readdirSync(CONTEXT).sort()) if (fs.statSync(path.join(CONTEXT, f)).isFile()) h.update(f).update(fs.readFileSync(path.join(CONTEXT, f)));
  return h.digest('hex').slice(0, 16);
}

/** Built, and built from this DOCA's clients/computer (an image from before its tools changed is `current: false`). */
async function imageState() {
  try {
    // `index` fails on an image with no labels at all (one built before they existed), so read them whole.
    const labels = JSON.parse(await docker(['image', 'inspect', '--format', '{{ json .Config.Labels }}', IMAGE]) || 'null') || {};
    return { name: IMAGE, ready: true, current: labels['doca.computer.source'] === sourceHash() };
  } catch { return { name: IMAGE, ready: false, current: false }; }
}

/** Build the image from clients/computer (minutes the first time: Chromium, a desktop, ffmpeg). */
function build(onLine = () => {}) {
  return new Promise((resolve, reject) => {
    const child = require('child_process').spawn(require('../containers').cli(), ['build', '-t', IMAGE, '--label', `doca.computer.source=${sourceHash()}`, CONTEXT], { windowsHide: true });
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
  const started = await registry.start(serverId(c));
  if (c.test) await require('./test-mode').apply(c);   // a restarted control server starts ordinary: told again
  return started;
}

/**
 * `auto`: an agent made it, so it is tidied away after it stops (lifecycle.js) unless a person pins it. `test`: made for
 * testing a site or an app — sign-ins without asking (test-mode.js); never on a computer a specialist keeps.
 */
async function create({ name, purpose = '', missionId = null, by = null, auto = false, agentType = null, keptFor = null, test = false } = {}) {
  if (!(await imageReady())) throw bad('The computer image is not built yet: build it once (Computers → Build the image).', 409);
  await require('./lifecycle').roomForOne();
  const c = { id: crypto.randomBytes(4).toString('hex'), name: String(name || 'computer').replace(/[^\w .-]/g, '').slice(0, 40) || 'computer',
    purpose: String(purpose).slice(0, 300), missionId, by, auto: !!auto, pinned: false, ...(agentType ? { agentType } : test === true ? { test: true } : {}), ...(keptFor ? { keptFor } : {}), token: crypto.randomBytes(24).toString('hex'),
    fillKey: crypto.randomBytes(24).toString('hex'),   // the hub's alone: it unlocks browser_fill_secret (logins.js)
    vncPassword: crypto.randomBytes(6).toString('hex'), mcpPort: await freePort(), vncPort: await freePort(), servePort: await freePort(), createdAt: new Date().toISOString() };
  try {
    await docker(['run', '-d', '--name', container(c), '--shm-size=1g', '--label', 'doca.computer=1', '--label', `doca.install=${require('./strays').installId()}`,
      '-p', `127.0.0.1:${c.mcpPort}:8765`, '-p', `127.0.0.1:${c.vncPort}:6080`, '-p', `127.0.0.1:${c.servePort}:${SERVE}`,
      '-e', `TOKEN=${c.token}`, '-e', `VNC_PASSWORD=${c.vncPassword}`, '-e', `FILL_KEY=${c.fillKey}`,
      '-v', `${container(c)}:/home/agent`, IMAGE]);
  } catch (e) {
    // Made but not started (a port taken, say): no record will name it, so it goes now rather than sit in "created" (strays.js).
    await docker(['rm', '-f', container(c)]).catch(() => {});
    await docker(['volume', 'rm', '-f', container(c)]).catch(() => {});
    throw e;
  }
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

/** Put away (modules/archive.js): stopped, its desktop and files kept, out of the Computers tab and the agents' list until restored. */
async function archive(id, on = true) {
  const c = need(id);
  if (on) await stop(c.id).catch(() => {});
  patch(c.id, { archivedAt: on ? new Date().toISOString() : null });
  return view({ ...c, archivedAt: on ? 'now' : null });
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
    auto: !!c.auto, pinned: !!c.pinned, test: !!c.test, stoppedAt: c.stoppedAt || null, archivedAt: c.archivedAt || null, by: c.by || null, agentType: c.agentType || null, keptFor: c.keptFor || null,
    server: serverId(c), tools: `mcp__${serverId(c)}__*`,
    serve: c.servePort ? { inside: SERVE, port: c.servePort } : null,   // a computer made before H10.18 has none: make a new one
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
async function ownFor(def, person = null) {
  // An admin's missions share the type's kept computer; anyone else's specialist keeps one of its own for that person —
  // a kept desktop holds sign-ins and files, and another person's are never lent to them (security review 2026-10-07).
  const mine = person?.id && !require('../auth/rights').can(person.role, 'host') ? person.id : null;
  const have = rows().find(c => c.agentType === def.id && (c.keptFor || null) === mine);
  if (have) return have.id;
  return (await module.exports.create({ name: `${def.label}'s computer`.slice(0, 40), purpose: `Kept for ${def.label}: the same desktop, logins and files every mission.`,
    agentType: def.id, ...(mine ? { keptFor: mine } : {}) })).id;
}

function lend(id, missionId) {
  const c = need(id);
  patch(c.id, { missionId, missions: [...(c.missions || []), missionId].slice(-20), archivedAt: null });   // lent again: back from the archive
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

async function list({ all = false } = {}) {
  let states = {};
  try {
    const out = await docker(['ps', '-a', '--filter', 'label=doca.computer=1', '--format', '{{.Names}}\t{{.State}}']);
    states = Object.fromEntries(out.split('\n').filter(Boolean).map(l => l.split('\t')));
  } catch { /* docker absent: states unknown */ }
  return rows().filter(c => all || !c.archivedAt).map(c => view(c, states[container(c)] || 'missing'));
}

module.exports = { IMAGE, SERVE, imageReady, imageState, sourceHash, build, create, start, stop, remove, pin, archive, list, detailed, screen, lend, ownFor, get, all, madeBy, need, put, fetchFile, patch, view, save, rows };
