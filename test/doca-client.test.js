'use strict';

// doca-client (clients/node, TODO H6.2/H6.6): a machine pairs with a code, lends its files and shell with its
// person's consent as an MCP server, the hub accepts the offer once, and its agents work on that machine — until
// a family is revoked from the hub, which the client then refuses.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./helpers');

let dir, root, ctrl, client, deviceId, serverId, lending;
before(async () => {
  await H.start();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-client-'));
  root = path.join(dir, 'home'); fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'notes.txt'), 'from the laptop\n');
  process.env.DOCA_CLIENT_DIR = path.join(dir, 'cfg');
  client = require('../clients/node/doca-client');
  ctrl = new AbortController();
});
after(async () => { ctrl.abort(); try { require('../modules/mcp/registry').stop(serverId); } catch {} await lending?.stop(); await H.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('it pairs with a code made in the panel, and keeps the token to itself', async () => {
  const start = await H.api(null, 'POST', '/api/devices/pair', { name: 'laptop', preset: 'phone' });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const cfg = await client.pair(H.base, start.body.code, { name: 'laptop' });
  deviceId = cfg.deviceId;
  assert.match(cfg.token, /^doca_dev_/);
  const mode = fs.statSync(client.configFile()).mode & 0o777;
  if (process.platform !== 'win32') assert.equal(mode, 0o600, 'the token file is its owner\'s alone');
  assert.equal(require('../modules/api-v1/devices').get(deviceId).userId, H.owner.user.id, 'the machine is the person\'s who paired it');
});

test('it lends what was granted; once its offer is accepted the agent works on that machine', async () => {
  lending = await client.run({ grant: ['files', 'shell'], bind: '127.0.0.1', port: 0, root, signal: ctrl.signal });
  const { url } = lending;
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  const offers = (await H.api(null, 'GET', '/api/mcp')).body.offers || [];
  const offer = offers.find(o => o.deviceId === deviceId);
  assert.ok(offer, 'an offer waits for a click');
  assert.deepEqual(offer.tools.sort(), ['files_copy', 'files_delete', 'files_list', 'files_mkdir', 'files_move', 'files_read', 'files_write', 'shell_run']);
  const acc = await H.api(null, 'POST', `/api/mcp/offers/${offer.id}/accept`);
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  const reg = require('../modules/mcp/registry');
  serverId = reg.forDevice(deviceId).id;
  if (reg.client(serverId)?.state !== 'running') await reg.start(serverId);
  const tools = require('../modules/harness/tools');
  const listing = await tools.call(`mcp__${serverId}__files_list`, { path: '' });
  assert.match(listing, /notes\.txt/);
  const ran = await tools.call(`mcp__${serverId}__shell_run`, { command: process.platform === 'win32' ? 'Write-Output hi-there' : 'echo hi-there' });
  assert.match(ran, /hi-there/);
  assert.match(await tools.call(`mcp__${serverId}__files_read`, { path: '../../etc/passwd' }), /outside what this machine shares/);
  const viaTab = await H.api(null, 'GET', `/api/devices/${deviceId}/files/list?path=`);
  assert.equal(viaTab.status, 200, JSON.stringify(viaTab.body));
  assert.ok(viaTab.body.entries.some(e => e.name === 'notes.txt'), 'the Files tab browses the machine');
});

test('a family revoked from the hub is refused by the client from then on', async () => {
  require('../modules/devices-control').send(deviceId, 'revoke', { family: 'shell', by: H.owner.user.id });
  let acked = false;
  for (let i = 0; i < 100 && !acked; i++) { await H.sleep(50); acked = !!require('../modules/devices-control').state(deviceId).history?.[0]?.ackAt; }
  assert.ok(acked, 'the client acknowledged');
  const out = await require('../modules/harness/tools').call(`mcp__${serverId}__shell_run`, { command: 'echo nope' });
  assert.match(out, /not lent by this machine/);
});

test('a hub over HTTPS is pinned at pairing: another certificate later is refused, not trusted', async () => {
  const https = require('node:https');
  const selfsigned = require('selfsigned');
  const make = async () => selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, algorithm: 'sha256', notAfterDate: new Date(Date.now() + 86400000) });
  const answer = (req, res) => { res.writeHead(req.url.includes('pair/complete') ? 201 : 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ token: 'doca_dev_x.y', device: { id: 'dev_pin' }, server: {} })); };
  const a = await make(), b = await make();
  let srv = https.createServer({ key: a.private, cert: a.cert }, answer);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const saved = process.env.DOCA_CLIENT_DIR;
  process.env.DOCA_CLIENT_DIR = path.join(dir, 'pin');
  try {
    const cfg = await client.pair(`https://127.0.0.1:${port}`, '000-000', { name: 'pinned' });
    assert.match(cfg.pinPem, /^-----BEGIN CERTIFICATE-----/);
    assert.match(cfg.pinFp, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    srv.closeAllConnections(); await new Promise(r => srv.close(r));
    srv = https.createServer({ key: b.private, cert: b.cert }, answer);
    await new Promise(r => srv.listen(port, '127.0.0.1', r));
    await assert.rejects(client.run({ grant: [], bind: '127.0.0.1', port: 0 }), /certificate changed/);
    // And the pinned one is accepted: back to certificate a.
    srv.closeAllConnections(); await new Promise(r => srv.close(r));
    srv = https.createServer({ key: a.private, cert: a.cert }, answer);
    await new Promise(r => srv.listen(port, '127.0.0.1', r));
    const r = await client.request(client.load(), 'GET', '/api/v1/capabilities');
    assert.equal(r.status, 200, 'the pinned certificate is trusted');
  } finally { process.env.DOCA_CLIENT_DIR = saved; srv.closeAllConnections(); await new Promise(r => srv.close(r)); }
});
