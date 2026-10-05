'use strict';

/**
 * Sending a pack to another hub (TODO H4.5). A destination is another DOCA's address and a device token it issued
 * with the `hub` preset (`packs:send`, nothing else). Adding one knocks first without the token — `/api/branding`,
 * public — and keeps the certificate it presented: a self-signed hub is pinned (only that certificate is trusted
 * from then on, the way doca-client pins its hub), one the system trusts is verified as usual. Only then is the
 * token sent, to `GET /api/v1/packs`, which says the token is good. Destinations live in DATA_DIR/keys/hubs.json
 * (0600, out of the file tools' reach); the token never reads back.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const file = () => require('../paths').HUB_KEYS_FILE;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const all = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
function write(d) { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(d, null, 2), { mode: 0o600 }); try { fs.chmodSync(file(), 0o600); } catch { /* Windows */ } }
const pemOf = raw => `-----BEGIN CERTIFICATE-----\n${raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;

/** One request. `first`: no token, any certificate, and report it. Otherwise pinned (or system-verified). */
function request(dest, method, p, { body, headers = {}, first = false } = {}) {
  const u = new URL(p, dest.url);
  const tls = u.protocol !== 'https:' ? {} : first ? { rejectUnauthorized: false }
    : dest.pinPem ? { ca: dest.pinPem, rejectUnauthorized: true, checkServerIdentity: () => undefined } : { rejectUnauthorized: true };
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? https : http).request(u, { method, timeout: 60000, ...tls,
      headers: { Accept: 'application/json', ...(first || !dest.token ? {} : { Authorization: `Bearer ${dest.token}` }), ...headers } }, res => {
      const cert = first && res.socket.getPeerCertificate ? res.socket.getPeerCertificate() : null;
      const parts = [];
      res.on('data', d => parts.push(d));
      res.on('end', () => { const bytes = Buffer.concat(parts), raw = bytes.toString('utf8'); let json = null; try { json = JSON.parse(raw); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, body: json, bytes, tls: cert ? { authorized: res.socket.authorized === true, pem: cert.raw ? pemOf(cert.raw) : null, fp: cert.fingerprint256 || null } : null }); });
    });
    req.on('timeout', () => req.destroy(new Error('no answer in time')));
    req.on('error', e => reject(bad(dest.pinPem && /CERT|SELF_SIGNED|certificate/i.test(`${e.code} ${e.message}`)
      ? `${dest.url}'s certificate changed since it was added (pinned ${dest.pinFp}). Remove and add it again if that was expected.` : `${dest.url}: ${e.message}`, 502)));
    if (body) req.write(body);
    req.end();
  });
}

const view = d => ({ id: d.id, url: d.url, label: d.label, hub: d.hub || null, pinned: d.pinFp || null, addedAt: d.addedAt,
  send: d.send !== false, read: !!d.read });
const list = () => Object.values(all()).map(view);

async function add({ url, token, label }) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/.test(u)) throw bad('The other hub\'s address, like https://office.tailnet.ts.net:4242.');
  if (!String(token || '').trim()) throw bad('A device token the other hub issued with the "hub" preset.');
  const knock = await request({ url: u }, 'GET', '/api/branding', { first: true });
  if (knock.status !== 200 || !knock.body?.product) throw bad(`${u} does not answer as a DOCA hub.`, 502);
  const dest = { id: `hub_${crypto.randomBytes(5).toString('hex')}`, url: u, token: String(token).trim(), label: String(label || knock.body.product).slice(0, 60),
    ...(knock.tls && !knock.tls.authorized ? { pinPem: knock.tls.pem, pinFp: knock.tls.fp } : {}), addedAt: new Date().toISOString() };
  // What the token may do there: send (the hub preset) and/or browse what it publishes (the registry preset).
  const hello = await request(dest, 'GET', '/api/v1/packs');
  const reg = await request(dest, 'GET', '/api/v1/packs/published');
  dest.send = hello.status === 200;
  dest.read = reg.status === 200;
  if (!dest.send && !dest.read) throw bad(`${u} refused the token (${hello.status}${hello.body?.error?.message ? `: ${hello.body.error.message}` : ''}). It needs the "hub" preset (to send) or "registry" (to browse what it publishes).`, 400);
  dest.hub = hello.body?.hub || reg.body?.hub;
  write({ ...all(), [dest.id]: dest });
  return view(dest);
}

function remove(id) { const d = all(); if (!d[id]) throw bad('No such hub.', 404); delete d[id]; write(d); return { removed: id }; }

/** Send a library pack to a destination: a multipart POST of the .dpack. */
async function send(destId, packId) {
  const dest = all()[destId];
  if (!dest) throw bad('No such hub.', 404);
  const { meta, buffer } = require('./library').get(packId);
  const boundary = `----doca${crypto.randomBytes(8).toString('hex')}`;
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${meta.name.replace(/[^\w.-]+/g, '-')}.dpack"\r\nContent-Type: application/zip\r\n\r\n`),
    buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const r = await request(dest, 'POST', '/api/v1/packs', { body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length } });
  if (r.status !== 201) throw bad(`${dest.label} did not take it (${r.status}${r.body?.error?.message ? `: ${r.body.error.message}` : ''}).`, 502);
  return { sent: packId, to: dest.label, received: r.body.received };
}

/** What another hub publishes (its registry; experiments.packRegistry on both sides). */
async function browse(destId) {
  const dest = all()[destId];
  if (!dest) throw bad('No such hub.', 404);
  const r = await request(dest, 'GET', '/api/v1/packs/published');
  if (r.status !== 200) throw bad(`${dest.label} publishes nothing to this token (${r.status}).`, 502);
  return { hub: r.body.hub, packs: r.body.packs };
}

/** Fetch one into this library, marked as from that registry — nothing applied. */
async function fetchPack(destId, packId) {
  const dest = all()[destId];
  if (!dest) throw bad('No such hub.', 404);
  if (!/^pk_[a-f0-9]{12}$/.test(String(packId))) throw bad('No such pack.', 404);
  const r = await request(dest, 'GET', `/api/v1/packs/published/${packId}`);
  if (r.status !== 200) throw bad(`${dest.label} did not serve it (${r.status}).`, 502);
  return require('./library').save(r.bytes, { origin: 'registry', from: dest.label });
}

module.exports = { list, add, remove, send, browse, fetchPack };
