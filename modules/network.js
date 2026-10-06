'use strict';

/**
 * Who can reach this hub, and from where (asked 2026-10-06: "can we pair out of tailscale? maybe in the local network?
 * should we limit the users' reach if they are not in the tailscale network? … the qr code that links us to the hub").
 *
 * - **How it listens** (`network.listen`, listen.js): `tailnet` (the default), `lan` (the tailnet and the local network:
 *   a phone on the home Wi-Fi pairs and signs in without Tailscale), `local`, `all`. `DOCA_LISTEN` wins over it. A
 *   change takes effect at the next start: the guard is set on the socket when the server listens.
 * - **What a person may do from outside** loopback and the tailnet (`network.lanAdmin`, default off): from the local
 *   network — or anywhere, under `all` — a person may read, chat and use their own devices, but the machine's
 *   administration (rights host, org, users, devices, delegate) is refused; it stays on Tailscale or the machine
 *   itself. `auth/gate.js` asks `limited()`; `/api/auth/me` leaves those rights out so the panel does not offer them.
 * - **The hub's addresses** (`links()`): this request's own, the tailnet's (its 100.x and MagicDNS names) and, when
 *   the local network is allowed, the private ones — each with a QR code a phone scans to open the hub.
 */
const os = require('os');
const listen = require('./listen');

const MACHINE = new Set(['host', 'org', 'users', 'devices', 'delegate']);
const schema = () => require('./settings-schema');
const lanAdmin = () => schema().value('network.lanAdmin') === true;

/** Whether this request came from outside loopback and the tailnet. */
const outside = req => listen.outside(req?.socket?.remoteAddress || req?.connection?.remoteAddress || '');

/** Whether a right is refused to this request because of where it came from. */
const limited = (req, right) => MACHINE.has(right) && outside(req) && !lanAdmin();

/** The rights a person holds from where this request came: the machine's left out from outside, unless allowed. */
const rightsFrom = (req, rights) => (outside(req) && !lanAdmin() ? rights.filter(r => !MACHINE.has(r)) : rights);

function state() {
  const prefs = require('./utils').loadPrefs();
  return { listen: listen.mode(prefs), saved: prefs.network?.listen || listen.DEFAULT, env: process.env.DOCA_LISTEN || null,
    lanAdmin: lanAdmin(), modes: listen.MODES };
}

function save({ listen: m, lanAdmin: la }) {
  const { loadPrefs, savePrefs } = require('./utils');
  const prefs = loadPrefs();
  const next = { ...(prefs.network || {}) };
  if (m !== undefined) {
    if (!listen.MODES.includes(m)) throw Object.assign(new Error(`One of: ${listen.MODES.join(', ')}.`), { status: 400 });
    next.listen = m;
  }
  if (la !== undefined) next.lanAdmin = la === true;
  savePrefs({ ...prefs, network: next });
  return { ...state(), restartNeeded: m !== undefined && m !== listen.mode(prefs) };
}

/** The addresses a phone can open this hub at, best first, each with a QR code. */
async function links(req) {
  const port = Number(process.env.PORT) || 4242;
  const proto = req.secure || req.socket?.encrypted ? 'https' : 'http';
  const out = [], seen = new Set();
  const add = (host, label) => { const url = `${proto}://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}/`; if (!seen.has(url)) { seen.add(url); out.push({ url, label }); } };
  const m = listen.mode(require('./utils').loadPrefs());
  for (const [, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.internal || a.family !== 'IPv4') continue;
      if (listen.isTailnet(a.address) && m !== 'local') add(a.address, 'Tailscale');
      else if (listen.isPrivate(a.address) && (m === 'lan' || m === 'all')) add(a.address, 'local network');
    }
  }
  const dns = await tailnetName();
  if (dns && m !== 'local') out.unshift({ url: `${proto}://${dns}:${port}/`, label: 'Tailscale name' });
  const here = String(req.headers.host || '').replace(/:\d+$/, '');
  if (here && !/^(localhost|127\.|\[?::1)/.test(here)) add(here, 'as you opened it');
  const qrcode = (() => { try { return require('qrcode'); } catch { return null; } })();
  for (const l of out) {
    try { l.qr = qrcode ? await qrcode.toString(l.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 240, color: { dark: '#000000', light: '#ffffff' } }) : null; } catch { l.qr = null; }
  }
  return { links: out, mode: m };
}

let _dns = { at: 0, name: null };
/** This machine's MagicDNS name, from `tailscale status --json` (cached for ten minutes). */
async function tailnetName() {
  if (Date.now() - _dns.at < 600000) return _dns.name;
  _dns = { at: Date.now(), name: null };
  try {
    const { execFile } = require('child_process');
    const out = await new Promise((resolve, reject) => execFile('tailscale', ['status', '--json'], { timeout: 4000 }, (e, so) => (e ? reject(e) : resolve(so))));
    _dns.name = String(JSON.parse(out).Self?.DNSName || '').replace(/\.$/, '') || null;
  } catch { /* no tailscale CLI */ }
  return _dns.name;
}

function mount(app) {
  const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/api/network', h(() => state()));
  app.post('/api/network', h(req => save(req.body || {})));
  app.get('/api/hub/links', h(req => links(req)));
}

module.exports = { MACHINE, outside, limited, rightsFrom, state, save, links, mount };
