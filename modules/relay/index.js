'use strict';

/**
 * The model relay (the owner's, 2026-10-14; CONSTITUTION S4 — secrets usable, never readable): an OpenAI-compatible
 * `POST /v1/chat/completions` (streamed or not) and `GET /v1/models`, answered for a caller holding a relay token and
 * sent on through this hub's own providers (harness/providers.js, turn/transport.js post) — so a program inside an
 * agents' computer (a DOCA installed there to test it, a script, an SDK) uses the hub's models with
 * `OPENAI_BASE_URL` and `OPENAI_API_KEY=<its relay token>`, and the provider's key never leaves the hub. Before it, a
 * model reached a computer only by copying a key into it, or by a forwarder opening a model server to every container.
 *
 * It listens on a small listener of its own (serve.js), never on the panel's: on Linux the Docker bridge's gateway —
 * what `host.docker.internal` is inside a computer (computers/index.js adds it) — and loopback on Docker Desktop, which
 * forwards that name to the host's loopback. The panel's listen rule (listen.js) is untouched, and the listener runs
 * only while the relay is on for computers.
 *
 * Who: an agents' computer whose own switch is on (relay/computer.js), with the token the hub made for it, while the
 * owner's switch (prefs `relay.enabled`, Field → API keys → Model relay) is on and open to computers. Paired devices
 * would need an /api/v1 scope of their own, which is ask-first (S11): `relay.devices` is declared and drawn disabled.
 * Which models: `relay.models`, else the harness's own model and its fallbacks — and of those only what the computer's
 * person is allotted (auth/allot.js), within their budget and the harness's daily ceiling (turn/ceiling.js), counted
 * in the usage ledger for them (serve.js).
 */
const http = require('http');

const value = k => require('../settings-schema').value(`relay.${k}`);
const enabled = () => value('enabled') === true;
const forComputers = () => value('computers') === true;

/** The models it offers: { provider, model }, in order. */
function offered() {
  const listed = value('models').map(s => String(s).trim()).filter(s => s.includes('/'))
    .map(s => ({ provider: s.slice(0, s.indexOf('/')), model: s.slice(s.indexOf('/') + 1) })).filter(e => e.provider && e.model);
  if (listed.length) return listed;
  try { return require('../harness/turn/choice').order(require('../harness/turn/params').params()).filter(e => e.provider && e.model).map(({ provider, model }) => ({ provider, model })); }
  catch { return []; }
}

/** What `person` may use of them (no person: all, as a turn without one is not narrowed). */
function allowedFor(person) {
  const allot = require('../auth/allot');
  return offered().filter(e => !person?.id || allot.allowsModel(person, e));
}

/** The entry a request's `model` names — `model` or `provider/model`; empty or "default" is the first. */
function resolve(name, list) {
  const n = String(name || '').trim();
  if (!n || n === 'default') return list[0] || null;
  return list.find(e => `${e.provider}/${e.model}` === n) || list.find(e => e.model === n) || null;
}

/* ── The listener ─────────────────────────────────────── */

let server = null, bound = null, why = null, pinned = null;

/** The Docker bridge's gateway on this machine, or null. */
async function bridge() {
  try {
    const out = await require('../computers/strays').docker(['network', 'inspect', 'bridge', '--format', '{{range .IPAM.Config}}{{.Gateway}} {{end}}']);
    const ip = String(out).split(/\s+/).find(x => /^\d+\.\d+\.\d+\.\d+$/.test(x));
    if (ip) return ip;
  } catch { /* docker absent or stopped */ }
  const nic = require('os').networkInterfaces().docker0 || [];
  return nic.find(a => a.family === 'IPv4' || a.family === 4)?.address || null;
}

async function address() {
  const set = String(value('address') || '').trim();
  if (set) return set;
  return process.platform === 'linux' ? bridge() : '127.0.0.1';
}

/** Where a computer finds it. */
const computerUrl = (port = bound?.port || value('port')) => `http://host.docker.internal:${port}/v1`;

function close() {
  const s = server;
  server = null; bound = null;
  return s ? new Promise(r => s.close(() => r())) : Promise.resolve();
}

/**
 * Listen when the relay is on for computers, stop when not; again on a changed address or port. `at` pins both for
 * this process (the tests: loopback, any free port). → state()
 */
async function sync(at = null) {
  if (at) pinned = at;
  if (!enabled() || !forComputers()) { why = enabled() ? 'not open to agents\' computers' : 'off'; await close(); return state(); }
  const host = pinned?.address || await address();
  const port = pinned?.port ?? value('port');
  if (!host) { why = 'no Docker bridge on this machine to listen on (set relay.address)'; await close(); return state(); }
  if (server && bound?.host === host && (bound.asked === port)) return state();
  await close();
  const s = http.createServer((req, res) => require('./serve').handle(req, res));
  s.headersTimeout = 60000;
  s.requestTimeout = 0;   // a long answer is streamed for as long as it takes
  try {
    await new Promise((resolve, reject) => { s.once('error', reject); s.listen(port, host, () => { s.off('error', reject); resolve(); }); });
    server = s; bound = { host, port: s.address().port, asked: port }; why = null;
    console.log(`[relay] the model relay listens on ${host}:${bound.port} for agents' computers`);
  } catch (e) {
    why = `could not listen on ${host}:${port} (${e.code || e.message})`;
    console.warn(`[relay] ${why}`);
  }
  return state();
}

/** For the card: on, open to whom, where it listens or why not, and the models. Never a token. */
function state() {
  return { enabled: enabled(), computers: forComputers(), devices: false,
    devicesNote: 'Paired devices need an /api/v1 scope of their own for this, which waits for the owner\'s yes (CONSTITUTION S11).',
    listening: bound ? { address: bound.host, port: bound.port, url: computerUrl(bound.port) } : null, reason: bound ? null : why,
    models: value('models'), port: value('port'), address: value('address'), offered: offered() };
}

module.exports = { enabled, forComputers, offered, allowedFor, resolve, address, computerUrl, sync, close, state };
