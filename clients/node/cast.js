'use strict';

/**
 * doca-client's `cast` family (docs/design/cast-reach.md §2.3, §6.2; R3f, the owner's yes of 2026-10-13): this machine
 * as the relay that serves a page or a sound to a TV or speaker on its own network, when the hub is somewhere else.
 *
 *   cast_serve  open a door for one cast: a plain-HTTP listener on this machine's address on the target's network, a
 *               random port, answering the target's address only. A page cast forwards each request byte for byte to
 *               the hub over the pinned connection, adding no token or cookie of its own (the hub sees the TV's own
 *               view session); a sound comes with the cast (`media`: its bytes and one-time token) and is served from
 *               here — nothing is forwarded for it. Rewrites: Host and Origin become the hub's; Set-Cookie loses
 *               Secure (the TV holds it over HTTP); answers stream (a page's live feed is SSE).
 *   cast_send   this machine's own Cast v2 sender (the hub's, castv2/): show a page (DashCast), play a sound (the
 *               Default Media Receiver), stop, volume
 *   cast_end    close the door for a cast
 * A door closes at cast_end, or by itself after `ttlSec` (a page: 3 h; a sound: 10 min after it was last fetched).
 */
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function sender() {
  for (const dir of [path.join(__dirname, 'castv2'), path.join(__dirname, '..', '..', 'modules', 'cast', 'castv2')]) {
    try { return require(path.join(dir, 'sender')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND' || !String(e.message).includes('sender')) throw e; }
  }
  throw new Error('This doca-client lacks castv2/sender.js: run "doca-client update" once more.');
}

// Tests set DOCA_CLIENT_CAST_LOOPBACK=1 to cast to 127.0.0.1 from 127.0.0.1, as the hub's door takes DOCA_CAST_DOOR_ADDRESS.
const PRIVATE_V4 = process.env.DOCA_CLIENT_CAST_LOOPBACK === '1' ? /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.0\.0\.1$)/ : /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const plain = a => String(a || '').replace(/^::ffff:/, '');
const MAX_MEDIA = 10 * 1024 * 1024;
const HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'authorization'];
const doors = new Map();   // cast id → { server, target, page, media: Map token → {buf, mime}, base, timer, last }

/** This machine's private IPv4 on the target's network (same /24), or null. */
function addressFor(target, ifs = os.networkInterfaces()) {
  if (process.env.DOCA_CLIENT_CAST_LOOPBACK === '1' && plain(target) === '127.0.0.1') return '127.0.0.1';
  const t = plain(target).split('.').slice(0, 3).join('.');
  for (const list of Object.values(ifs)) for (const i of list || [])
    if ((i.family === 'IPv4' || i.family === 4) && !i.internal && PRIVATE_V4.test(i.address) && i.address.split('.').slice(0, 3).join('.') === t) return i.address;
  return null;
}

function end(id) {
  const d = doors.get(id);
  if (!d) return false;
  doors.delete(id);
  clearTimeout(d.timer);
  d.server.closeAllConnections?.();
  d.server.close();
  return true;
}

function arm(id, ms) {
  const d = doors.get(id);
  if (!d) return;
  clearTimeout(d.timer);
  d.timer = setTimeout(() => end(id), ms);
  d.timer.unref?.();
}

/** Forward one request to the hub: pinned, no credentials of ours, Host and Origin the hub's, streamed both ways. */
function forward(cfg, tlsFor, d, req, res) {
  const hub = new URL(cfg.hub);
  const u = new URL(req.url, hub);
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.includes(k) && !k.startsWith('x-doca-')) headers[k] = v;
  headers.host = hub.host;
  if (headers.origin) headers.origin = hub.origin;
  if (headers.referer) headers.referer = String(headers.referer).replace(d.base, hub.origin);
  const mod = hub.protocol === 'https:' ? https : http;
  const up = mod.request(u, { method: req.method, headers, ...(hub.protocol === 'https:' ? tlsFor(cfg, false) : {}) }, r => {
    const h = { ...r.headers };
    for (const k of HOP) delete h[k];
    if (h['set-cookie']) h['set-cookie'] = [].concat(h['set-cookie']).map(c => c.replace(/;\s*secure/ig, ''));
    if (h.location) h.location = String(h.location).replace(hub.origin, d.base);
    res.writeHead(r.statusCode, h);
    r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('The hub did not answer.'); });
  req.pipe(up);
}

function handler(cfg, tlsFor, id) {
  return (req, res) => {
    const d = doors.get(id);
    if (!d || plain(req.socket.remoteAddress) !== d.target) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not here.'); }
    d.last = Date.now();
    const m = /^\/api\/cast\/media\/([0-9a-f]{32})$/.exec(String(req.url || '').split('?')[0]);
    if (m) {
      const f = d.media.get(m[1]);
      if (!f || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not here.'); }
      if (!d.page) arm(id, 10 * 60e3);
      res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': f.buf.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(req.method === 'HEAD' ? undefined : f.buf);
    }
    if (!d.page) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not here.'); }
    forward(cfg, tlsFor, d, req, res);
  };
}

async function serve(cfg, tlsFor, a = {}) {
  const id = String(a.cast || '').slice(0, 80);
  const target = plain(a.target);
  if (!id) throw new Error('cast_serve needs the cast id.');
  if (!PRIVATE_V4.test(target)) throw new Error('The target is a private IPv4 address on this machine\'s network.');
  const here = addressFor(target, a._ifs);
  if (!here) throw new Error(`This machine has no address on ${target}'s network.`);
  const media = new Map();
  let total = 0;
  for (const f of [].concat(a.media || [])) {
    if (!/^[0-9a-f]{32}$/.test(String(f.token))) throw new Error('A media token is 32 hex characters.');
    const buf = Buffer.from(String(f.data || ''), 'base64');
    total += buf.length;
    if (total > MAX_MEDIA) throw new Error('At most 10 MB of media in one cast.');
    media.set(f.token, { buf, mime: String(f.mime || 'application/octet-stream') });
  }
  const page = a.page === true;
  const was = doors.get(id);
  if (was && was.target === target) {   // the same cast again: more media, or now a page
    for (const [k, v] of media) was.media.set(k, v);
    was.page = was.page || page;
    arm(id, page || was.page ? (Number(a.ttlSec) || 3 * 3600) * 1000 : 10 * 60e3);
    return { base: was.base };
  }
  if (was) end(id);
  const server = http.createServer(handler(cfg, tlsFor, id));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, here, resolve); });
  const base = `http://${here}:${server.address().port}`;
  doors.set(id, { server, target, page, media, base, timer: null, last: Date.now() });
  arm(id, page ? (Number(a.ttlSec) || 3 * 3600) * 1000 : 10 * 60e3);
  return { base };
}

/** This machine's own Cast sender: show, play, stop, volume. */
async function send(a = {}) {
  const { connect, APPS, NS } = sender();
  const host = plain(a.target?.address || a.target), port = Number(a.target?.port) || 8009;
  if (!PRIVATE_V4.test(host)) throw new Error('The target is a private IPv4 address on this machine\'s network.');
  const s = await connect({ host, port });
  try {
    if (a.do === 'page') {
      if (!/^http:\/\//.test(String(a.url || ''))) throw new Error('A page is an http:// address this machine serves (cast_serve\'s base).');
      const app = await s.launch(APPS.dashcast);
      s.send(app.transportId, NS.dashcast, { url: a.url, force: true, reload: false, reload_time: 0 });
      return { ok: true, state: { app: 'page' } };
    }
    if (a.do === 'media') {
      const app = await s.launch(APPS.media);
      const r = await s.request(app.transportId, NS.media, { type: 'LOAD', autoplay: true,
        media: { contentId: String(a.url), contentType: String(a.contentType || 'audio/mpeg'), streamType: a.streamType === 'LIVE' ? 'LIVE' : 'BUFFERED', metadata: { metadataType: 0, title: String(a.title || '').slice(0, 80) } } }, 20000);
      if (r.data?.type === 'LOAD_FAILED' || r.data?.type === 'LOAD_CANCELLED') throw new Error(`It could not play it (${r.data.type}).`);
      return { ok: true, state: { app: 'media', playing: true } };
    }
    if (a.do === 'stop') {
      const apps = (await s.status()).applications || [];
      for (const x of apps.filter(y => y.appId === APPS.dashcast || y.appId === APPS.media)) await s.stop(x.sessionId);
      return { ok: true, state: { app: null } };
    }
    if (a.do === 'volume') { const v = Math.max(0, Math.min(1, Number(a.value))); await s.volume(v); return { ok: true, state: { volume: v } }; }
    throw new Error('do is page, media, stop or volume.');
  } finally { s.close(); }
}

const token = () => crypto.randomBytes(16).toString('hex');

module.exports = ({ tlsFor }) => ({
  cast_serve: { family: 'cast', description: 'Open a door on this machine for one cast to a TV or speaker on its network: a page forwarded from the hub, or a sound served from here, to that device only.',
    input: { cast: 'string', target: 'string', page: 'boolean', media: 'array', ttlSec: 'number' }, run: (c, a) => serve(c, tlsFor, a) },
  cast_send: { family: 'cast', description: 'This machine\'s own Cast sender: show a page, play a sound, stop, or set the volume of a Cast device on its network.',
    input: { target: 'object', do: 'string', url: 'string', contentType: 'string', title: 'string', value: 'number' }, run: (_c, a) => send(a) },
  cast_end: { family: 'cast', description: 'Close this machine\'s door for a cast.', input: { cast: 'string' }, run: (_c, a) => ({ ok: end(String(a.cast || '')) }) },
});
module.exports.SHIPPED = ['sender.js', 'wire.js'];
module.exports._doors = doors;
module.exports.addressFor = addressFor;
module.exports.token = token;
