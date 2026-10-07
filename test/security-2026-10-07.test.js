'use strict';

/**
 * The security review of 2026-10-07: what counts as the owner's own address is decided by the address, not by how a
 * name begins; redirects are followed hop by hop (a key never leaves its origin, an owned address never hands over the
 * open web); a download from the open web keeps a file, never a page; a preview's app never gets DOCA's cookies.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const { owned, request } = require('../modules/harness/toolbox/http');

test('owned(): ranges for addresses only, names only when they are the owner\'s', () => {
  for (const u of ['http://10.evil.com/', 'https://192.168.attacker.net/', 'https://foo.tail1234.ts.net/', 'http://127.0.0.1.nip.io/', 'http://172.32.0.1/', 'https://example.com/'])
    assert.equal(owned(u), false, u);
  for (const u of ['http://10.0.0.5:8080/', 'http://192.168.1.2/', 'http://172.20.0.1/', 'http://100.64.0.1/', 'http://localhost:3000', 'http://[::1]/', 'http://[fd00::1]/', 'http://printer.local/', 'http://nas.lan/'])
    assert.equal(owned(u), true, u);
});

test('a redirect from an owned address to the open web is not followed; a key never follows another origin', async () => {
  const srv = http.createServer((q, r) => {
    if (q.url === '/out') { r.writeHead(302, { Location: 'https://example.com/page' }); return r.end(); }
    if (q.url === '/same') { r.writeHead(302, { Location: '/final' }); return r.end(); }
    r.end(`final ${q.url}`);
  }).listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.match(await request({ url: `${base}/out` }, {}), /redirects outside the owner's addresses/);
    assert.match(await request({ url: `${base}/same` }, {}), /final \/final/, 'a hop within the owner\'s address is followed');
  } finally { srv.close(); }
});

test('http_fetch save_as from the open web keeps only files, never a page', async () => {
  const tools = require('../modules/harness/tools');
  const real = global.fetch;
  global.fetch = async () => new Response('<html>a page</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  try {
    const out = await tools.call('http_fetch', { url: 'https://example.com/x', save_as: 'x.html' }, [], {});
    assert.match(out, /answered with text/);
  } finally { global.fetch = real; }
});

test('a preview\'s app gets its own cookies and none of DOCA\'s', () => {
  const { upstreamHeaders } = require('../modules/canvas/proxy');
  const h = upstreamHeaders({ headers: { cookie: 'doca_session=s3cr3t; doca_screen=x; doca_preview=t; app=1', authorization: 'Bearer z', 'x-doca-password': 'pw', origin: 'https://h' } }, 5173);
  assert.equal(h.cookie, 'app=1');
  assert.equal(h.authorization, undefined);
  assert.equal(h['x-doca-password'], undefined);
  assert.equal(h.host, '127.0.0.1:5173');
});
