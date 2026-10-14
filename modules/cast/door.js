'use strict';

/**
 * The hub's cast door (docs/design/cast-reach.md §2.2; the owner's yes of 2026-10-12): a Cast TV or speaker fetches
 * what it is given over plain HTTP from an address on its own network — it never loads a self-signed HTTPS address
 * (measured on a Google Home Mini) and the hub listens on the tailnet only. So, while a cast runs, a second plain-HTTP
 * server listens on this hub's private address on the target's network (`cast.doorPort`, 4250) and serves a request only
 * when its peer is the address of a cast running now (and 60 s after), and the path is one that cast needs:
 *   the view link (`GET /api/cast/open/:code`), the page's static files, what that page reads (cast/views.js), the
 *   looking POSTs it allows, and `GET /api/cast/media/:token` (one-time media, cast/media.js).
 * Everything else is a bare 404. An allowed request goes to the same Express app in process, so the gate, the view
 * session's `view:<page>` cap and `network.limited` apply unchanged: the peer is a private address, never a machine
 * right. Off unless the owner switched it on (`cast.door`, never proposable); closed when no cast needs it.
 */
const http = require('http');
const os = require('os');
const GRACE_MS = 60e3;

let _server = null, _bound = null, _app = null;   // the listener, the address it listens on, the panel's app
const _casts = new Map();                          // peer address → { page, tokens: Set, until: null | ms }

const value = k => require('../settings-schema').value(`cast.${k}`);
const plain = a => String(a || '').replace(/^::ffff:/, '');
const bad = (m, status = 409) => Object.assign(new Error(m), { status });

/** Whether the owner switched the door on. */
const on = () => value('door') === 'on';

/** This hub's private IPv4 address on the target's network (same /24), or null. Tests set DOCA_CAST_DOOR_ADDRESS. */
function addressFor(target) {
  if (process.env.DOCA_CAST_DOOR_ADDRESS) return process.env.DOCA_CAST_DOOR_ADDRESS;
  const t = plain(target).split('.');
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) {
    if (i.family !== 'IPv4' && i.family !== 4) continue;
    if (i.internal || !require('../listen').isPrivate(i.address)) continue;
    if (i.address.split('.').slice(0, 3).join('.') === t.slice(0, 3).join('.')) return i.address;
  }
  return null;
}

/** Whether this request may go through the door. */
function allows(req) {
  const c = _casts.get(plain(req.socket.remoteAddress));
  if (!c || (c.until && c.until < Date.now())) return false;
  const p = String(req.url || '').split('?')[0].replace(/\/+$/, '').toLowerCase() || '/';
  const m = /^\/api\/cast\/media\/([0-9a-f]{32})$/.exec(p);
  if (m) return req.method === 'GET' || req.method === 'HEAD' ? c.tokens.has(m[1]) : false;
  if (/^\/api\/cast\/open\/[a-z0-9]+$/.test(p)) return req.method === 'GET';
  if (!c.page) return false;   // a sound only: nothing else
  return require('./views').allows(c.page, req.method, p);
}

async function listen(address) {
  if (_server && _bound === address) return;
  await close();
  const server = http.createServer((req, res) => {
    if (allows(req)) { req.castDoor = true; return _app(req, res); }   // media.js serves a sound only through here
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not here.');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.DOCA_CAST_DOOR_PORT ?? value('doorPort')), address, resolve); });
  _server = server; _bound = address;
  require('../activity').note({ from: 'cast', what: `opened the cast door on ${address}:${server.address().port}`, why: 'a cast to a device on this network needs it (cast.door)' });
}

async function close() {
  if (!_server) return;
  const s = _server; _server = null; _bound = null;
  s.closeAllConnections?.();   // a TV's browser keeps its connection open: closing waits for nothing it holds
  await new Promise(r => s.close(() => r()));
}

/**
 * Let `target` (an IPv4 address) through for a cast: `page` (a view) or none (a sound), `tokens` its media. → the
 * door's origin as the target reaches it, `http://<this hub's address there>:<port>`.
 */
/** The owner's switch, asked as a question when off — the hub's door and a device's relay alike (relay.js). */
function needOn() {
  if (!on()) throw require('../switch-off').off('Casting to devices on this network is off (cast.door): switch it on in the Cast sheet or Machines → Nearby.', {
    what: 'Casting to devices on this network', setting: 'cast.door', route: '/api/cast/door', body: { on: true },
    page: 'nearby', card: 'Casting to devices on this network',
    why: 'TVs and speakers fetch what they are sent over plain HTTP from this hub\'s address on their network: while a cast runs, a door opens to that device alone, for that page or sound. It travels unencrypted on your Wi-Fi.' });
}

async function open(target, { page = null, tokens = [] } = {}) {
  needOn();
  if (!_app) throw bad('The cast door is not ready yet.', 503);
  const here = addressFor(target);
  if (!here) throw bad(`This hub has no address on ${plain(target)}'s network, so the device cannot reach it: a device of yours on that network that lends Cast (doca-client's cast family) casts there, once it has seen it in Nearby → Look from.`);
  await listen(here);
  const c = _casts.get(plain(target)) || { page: null, tokens: new Set(), until: null };
  c.page = page || c.page; c.until = null;
  for (const t of tokens) c.tokens.add(t);
  _casts.set(plain(target), c);
  return `http://${here}:${_server.address().port}`;
}

/** The cast to `target` ended: it may still fetch for a minute, then the door forgets it, and closes when nothing is left. */
function release(target) {
  const c = _casts.get(plain(target));
  if (!c) return;
  c.until = Date.now() + GRACE_MS;
  const t = setTimeout(() => {
    const now = _casts.get(plain(target));
    if (now && now.until && now.until <= Date.now()) _casts.delete(plain(target));
    if (!_casts.size) close().catch(() => {});
  }, GRACE_MS + 50);
  t.unref?.();
}

/** Given the panel's app once, in createApp; nothing listens until a cast asks. */
function attach(app) { _app = app; }

const state = () => ({ on: on(), listening: _server ? { address: _bound, port: _server.address().port } : null, casts: [..._casts.keys()] });

module.exports = { attach, open, release, allows, addressFor, on, needOn, state, close, _casts };
