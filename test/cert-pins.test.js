'use strict';

// A home server's own certificate, trusted by name (cert-pins.js; Proxmox VE, 2026-10-13): refused until the owner looks
// at its fingerprint and trusts that exact certificate (after a notice); then calls go through; another certificate
// at the same address is refused again; the open web is never trusted this way.
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const H = require('./helpers');

let server, origin, pems;
const serve = async p => {
  server = https.createServer({ key: p.private, cert: p.cert }, (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":[{"node":"pve"}]}'); });
  await new Promise(r => server.listen(origin ? Number(new URL(origin).port) : 0, '127.0.0.1', r));
  origin = `https://127.0.0.1:${server.address().port}`;
};
test.before(async () => {
  await H.start();
  pems = await require('selfsigned').generate([{ name: 'commonName', value: 'pve.lan' }], { days: 2, keySize: 2048 });
  await serve(pems);
});
test.after(async () => { server.close(); await H.stop(); });

const call = () => require('../modules/harness/toolbox/http').send({ url: `${origin}/api2/json/nodes` }, {});

test('refused at first, with where to trust it', async () => {
  const r = await call();
  assert.match(r.error, /presents its own certificate \(self-signed\).*Certificates you trust/);
});

test('looked at, trusted after a notice when the fingerprint matches, and then used', async () => {
  const seen = (await H.api(null, 'POST', '/api/connectors/certs/look', { origin })).body;
  assert.equal(seen.subject, 'pve.lan');
  assert.match(seen.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.equal(seen.pem, undefined, 'the certificate itself is not sent to the page');
  assert.equal((await H.api(null, 'POST', '/api/connectors/certs', { origin, fingerprint: 'AA:BB' })).status, 409, 'another fingerprint than the one seen');
  assert.equal((await H.api(null, 'POST', '/api/connectors/certs', { origin, fingerprint: seen.fingerprint }, { 'X-Doca-Password': '', 'X-Doca-Notice': '' })).status, 428, 'the notice is shown first');
  const t = await H.api(null, 'POST', '/api/connectors/certs', { origin, fingerprint: seen.fingerprint });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  const r = await call();
  assert.ok(!r.error, r.error);
  assert.equal(r.r.status, 200);
  assert.deepEqual(await r.r.json(), { data: [{ node: 'pve' }] });
  assert.equal((await H.api(null, 'GET', '/api/connectors/certs')).body.certs[0].origin, origin);
});

test('another certificate at that address is refused; the open web is never trusted by name; forgetting', async () => {
  server.close();
  await serve(await require('selfsigned').generate([{ name: 'commonName', value: 'pve.lan' }], { days: 2, keySize: 2048 }));
  const r = await call();
  assert.match(r.error, /not the one you trusted/);
  assert.equal((await H.api(null, 'POST', '/api/connectors/certs/look', { origin: 'https://example.com' })).status, 403);
  assert.equal((await H.api(null, 'DELETE', `/api/connectors/certs?origin=${encodeURIComponent(origin)}`)).status, 200);
  assert.deepEqual((await H.api(null, 'GET', '/api/connectors/certs')).body.certs, []);
});
