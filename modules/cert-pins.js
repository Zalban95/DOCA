'use strict';

/**
 * Certificates the owner trusts by name (the owner left the call to my judgement, 2026-10-13: Proxmox VE and other
 * home-lab servers make their own certificate, which the hub refuses). Never "accept any self-signed certificate":
 * a machine on the network could then pretend to be the server. Instead one exact certificate per address, kept when
 * the owner looked at its fingerprint and said yes — as doca-client pins its hub. Only the owner's own addresses (their
 * network, their tailnet: toolbox/http.owned), never the open web. Kept in keys/cert-pins.json (the protected folder).
 *
 *   look(origin)          the certificate the server presents now: fingerprint, subject, issuer, validity
 *   trust(origin, fp)     keep it — only if what it presents now still has the fingerprint the person saw
 *   forget(origin) · list()
 *   fetchPinned(url, init, pem)  a request trusting that certificate alone, answered as a Response (toolbox/http.js)
 */
const tls = require('tls');
const https = require('https');
const path = require('path');

const file = () => path.join(path.dirname(require('./paths').SERVICE_KEYS_FILE), 'cert-pins.json');
const all = () => require('./keys-file').read(file());
const write = d => require('./keys-file').write(file(), d);
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

/** An https origin on the owner's own address, or a refusal. */
function originOf(input) {
  let u;
  try { u = new URL(String(input)); } catch { throw bad('Give the server\'s address, like https://pve.lan:8006.'); }
  if (u.protocol !== 'https:') throw bad('Only an https address has a certificate to trust.');
  if (!require('./harness/toolbox/http').owned(u.href)) throw bad('A certificate is trusted by name only for your own addresses — your network or tailnet — never the open web.', 403);
  return u.origin;
}

const pemOf = raw => `-----BEGIN CERTIFICATE-----\n${raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;

/** What the server at `origin` presents now. */
function look(origin, { ms = 6000 } = {}) {
  const o = new URL(originOf(origin));
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host: o.hostname, port: Number(o.port) || 443, servername: /^\d/.test(o.hostname) ? undefined : o.hostname, rejectUnauthorized: false, timeout: ms }, () => {
      const c = s.getPeerCertificate();
      s.end();
      if (!c?.raw) return reject(bad('The server presented no certificate.', 502));
      resolve({ origin: o.origin, fingerprint: c.fingerprint256, subject: c.subject?.CN || null, issuer: c.issuer?.CN || null,
        validFrom: c.valid_from, validTo: c.valid_to, selfSigned: c.subject?.CN === c.issuer?.CN, trustedByName: !!get(o.origin), pem: pemOf(c.raw) });
    });
    s.on('timeout', () => { s.destroy(); reject(bad(`${o.host} did not answer.`, 504)); });
    s.on('error', e => reject(bad(`Cannot reach ${o.host}: ${e.code || e.message}.`, 502)));
  });
}

async function trust(origin, fingerprint) {
  const now = await look(origin);
  if (!fingerprint || String(fingerprint).toUpperCase() !== String(now.fingerprint).toUpperCase())
    throw bad('The server presents another certificate than the one you looked at: look again before trusting it.', 409);
  const d = all();
  d[now.origin] = { pem: now.pem, fingerprint: now.fingerprint, subject: now.subject, validTo: now.validTo, at: new Date().toISOString() };
  write(d);
  return view(now.origin, d[now.origin]);
}

function forget(origin) { const d = all(); const o = originOf(origin); delete d[o]; write(d); return { forgot: o }; }
const get = origin => all()[origin] || null;
const view = (origin, p) => ({ origin, fingerprint: p.fingerprint, subject: p.subject, validTo: p.validTo, at: p.at });
const list = () => Object.entries(all()).map(([o, p]) => view(o, p));

/** A request trusting `pem` alone (its name not checked: a home server is often reached by address), as a Response. */
function fetchPinned(url, { method = 'GET', headers = {}, body, signal } = {}, pem) {
  return new Promise((resolve, reject) => {
    const h = headers instanceof Headers ? Object.fromEntries(headers) : { ...headers };
    const data = body == null ? null : typeof body === 'string' || Buffer.isBuffer(body) ? body : null;
    if (body != null && data === null) return reject(bad('A form upload to a server trusted by name is not sent yet.', 400));
    const req = https.request(url, { method, headers: { ...h, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }, ca: pem,
      checkServerIdentity: () => undefined, rejectUnauthorized: true, signal }, res => {
      const parts = [];
      res.on('data', c => parts.push(c));
      res.on('end', () => {
        const hdrs = new Headers();
        for (const [k, v] of Object.entries(res.headers)) for (const x of [].concat(v)) hdrs.append(k, String(x));
        const nobody = [204, 304].includes(res.statusCode) || method === 'HEAD';
        resolve(new Response(nobody ? null : Buffer.concat(parts), { status: res.statusCode, headers: hdrs }));
      });
      res.on('error', reject);
    });
    req.on('error', e => reject(/CERT|certificate|self.signed/i.test(`${e.code} ${e.message}`) ? bad(`The server's certificate is not the one you trusted (${e.code || e.message}): look at it again in Field → Connectors.`, 502) : e));
    req.end(data || undefined);
  });
}

module.exports = { look, trust, forget, list, get, fetchPinned, originOf };

/**
 * Field → Connectors → Certificates you trust (host, under /api/connectors):
 *   GET    /api/connectors/certs                 what is trusted by name
 *   POST   /api/connectors/certs/look  {origin}  what that server presents now
 *   POST   /api/connectors/certs  {origin, fingerprint}  trust it — after a notice (auth/guarded.js)
 *   DELETE /api/connectors/certs?origin=…        trust it no more
 */
function mount(app) {
  const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/api/connectors/certs', h(() => ({ certs: list() })));
  app.post('/api/connectors/certs/look', h(async req => { const { pem, ...seen } = await look(req.body?.origin); return seen; }));
  app.post('/api/connectors/certs', h(async req => {
    const r = await trust(req.body?.origin, req.body?.fingerprint);
    require('./activity').note({ from: 'person', what: `trusted the certificate of ${r.origin} by name (${String(r.fingerprint).slice(0, 23)}…)`, why: 'Field → Connectors → Certificates you trust',
      person: { id: req.auth?.user?.id, name: req.auth?.user?.name || req.auth?.user?.email } });
    return r;
  }));
  app.delete('/api/connectors/certs', h(req => forget(req.query?.origin)));
}

module.exports.mount = mount;
