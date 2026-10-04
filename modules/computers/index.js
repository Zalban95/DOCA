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
    execFile('docker', args, { timeout, maxBuffer: 8 << 20, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(new Error(String(stderr || err.message).trim().split('\n').pop()), { status: 500 }));
      resolve(String(stdout).trim());
    });
  });
}

const rows = () => store.readJson(DOC, { computers: [] }).computers;
const save = list => store.writeJson(DOC, { computers: list });
const get = id => rows().find(c => c.id === id) || null;
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
    const child = require('child_process').spawn('docker', ['build', '-t', IMAGE, CONTEXT], { windowsHide: true });
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

async function create({ name, purpose = '', missionId = null, by = null } = {}) {
  if (!(await imageReady())) throw bad('The computer image is not built yet: build it once (Settings → … or POST /api/computers/image).', 409);
  const c = { id: crypto.randomBytes(4).toString('hex'), name: String(name || 'computer').replace(/[^\w .-]/g, '').slice(0, 40) || 'computer',
    purpose: String(purpose).slice(0, 300), missionId, by, token: crypto.randomBytes(24).toString('hex'),
    vncPassword: crypto.randomBytes(6).toString('hex'), mcpPort: await freePort(), vncPort: await freePort(), createdAt: new Date().toISOString() };
  await docker(['run', '-d', '--name', container(c), '--shm-size=1g', '--label', 'doca.computer=1',
    '-p', `127.0.0.1:${c.mcpPort}:8765`, '-p', `127.0.0.1:${c.vncPort}:6080`,
    '-e', `TOKEN=${c.token}`, '-e', `VNC_PASSWORD=${c.vncPassword}`,
    '-v', `${container(c)}:/home/agent`, IMAGE]);
  save([...rows(), c]);
  await connect(c);
  return view(c);
}

async function start(id) {
  const c = need(id);
  await docker(['start', container(c)]);
  await connect(c);
  return view(c);
}

async function stop(id) {
  const c = need(id);
  try { require('../mcp/registry').stop(serverId(c)); } catch { /* not connected */ }
  await docker(['stop', '-t', '5', container(c)]).catch(() => {});
  return view(c);
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
    server: serverId(c), tools: `mcp__${serverId(c)}__*`, vnc: { url: `http://127.0.0.1:${c.vncPort}/vnc.html?autoconnect=1&resize=scale`, password: c.vncPassword } };
}

async function list() {
  let states = {};
  try {
    const out = await docker(['ps', '-a', '--filter', 'label=doca.computer=1', '--format', '{{.Names}}\t{{.State}}']);
    states = Object.fromEntries(out.split('\n').filter(Boolean).map(l => l.split('\t')));
  } catch { /* docker absent: states unknown */ }
  return rows().map(c => view(c, states[container(c)] || 'missing'));
}

module.exports = { IMAGE, imageReady, build, create, start, stop, remove, list, get, need };
