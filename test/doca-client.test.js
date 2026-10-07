'use strict';

// doca-client (clients/node, TODO H6.2/H6.6): a machine pairs with a code, lends its files and shell with its
// person's consent as an MCP server, the hub accepts the offer once, and its agents work on that machine — until
// a family is revoked from the hub, which the client then refuses; and revoking the machine ends its lending on both
// sides.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./helpers');

let dir, root, ctrl, client, deviceId, serverId, lending;
const said = [];
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

test('it updates from its own hub: what differs is fetched, checked and replaced; the old copy kept', async () => {
  const there = path.join(dir, 'installed'); fs.mkdirSync(there);
  fs.writeFileSync(path.join(there, 'doca-client.js'), '// an old copy\n');
  fs.copyFileSync(path.join(__dirname, '..', 'clients', 'node', 'families.js'), path.join(there, 'families.js'));
  const u = await client.update({ dir: there });
  assert.equal(u.version, require('../package.json').version);
  assert.deepEqual(u.changed.sort(), ['README.md', 'boot.js', 'discover.js', 'doca-client.js', 'sealed.js'], 'the unchanged families.js is left alone');
  for (const f of ['doca-client.js', 'sealed.js', 'discover.js', 'boot.js', 'README.md'])
    assert.ok(fs.readFileSync(path.join(there, f)).equals(fs.readFileSync(path.join(__dirname, '..', 'clients', 'node', f))), `${f} byte for byte`);
  assert.equal(fs.readFileSync(path.join(process.env.DOCA_CLIENT_DIR, 'previous', 'doca-client.js'), 'utf8'), '// an old copy\n');
  assert.deepEqual((await client.update({ dir: there })).changed, [], 'nothing twice');
});

test('it lends what was granted; once its offer is accepted the agent works on that machine', async () => {
  // Its line is kept, not printed: Node's test runner reads a test's stdout between its own framed messages, and a
  // line starting "✓" right behind one (pipe reads coalesce under load) is read as a frame — "Unable to deserialize".
  lending = await client.run({ grant: ['files', 'shell'], bind: '127.0.0.1', port: 0, root, signal: ctrl.signal, log: m => said.push(m) });
  const { url } = lending;
  assert.match(said.join('\n'), /serves 8 tool\(s\) .* accept its offer/, 'it tells its person what it lends and what to do next');
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
    await assert.rejects(client.run({ grant: [], bind: '127.0.0.1', port: 0, log: () => {} }), /certificate changed/);
    // And the pinned one is accepted: back to certificate a.
    srv.closeAllConnections(); await new Promise(r => srv.close(r));
    srv = https.createServer({ key: a.private, cert: a.cert }, answer);
    await new Promise(r => srv.listen(port, '127.0.0.1', r));
    const r = await client.request(client.load(), 'GET', '/api/v1/capabilities');
    assert.equal(r.status, 200, 'the pinned certificate is trusted');
  } finally { process.env.DOCA_CLIENT_DIR = saved; srv.closeAllConnections(); await new Promise(r => srv.close(r)); }
});

test('revoking the machine ends its lending: the hub drops its server and the client stops serving', async () => {
  const reg = require('../modules/mcp/registry');
  assert.equal(reg.client(serverId)?.state, 'running', 'lending before');
  const r = await H.api(null, 'DELETE', `/api/devices/${deviceId}`);   // the panel's Revoke
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let gone = false;
  for (let i = 0; i < 100 && !gone; i++) { await H.sleep(20); gone = !reg.forDevice(deviceId); }
  assert.ok(gone, 'the server the device hosted is removed with it');
  assert.ok(!require('../modules/mcp/tools').available().some(t => t.server === serverId), 'none of its tools are offered');
  assert.match(await require('../modules/harness/tools').call(`mcp__${serverId}__files_list`, { path: '' }), /no MCP tool/);
  // The client: its event stream is closed, its next try is a 401, and it stops lending.
  let stopped = false;
  for (let i = 0; i < 200 && !stopped; i++) { await H.sleep(50); stopped = !lending.server.listening; }
  assert.ok(stopped, 'the client stopped serving');
  assert.match(said.join('\n'), /revoked laptop: it lends nothing now/);
  assert.ok(client.load().revokedAt, 'and remembers it');
  await assert.rejects(client.run({ grant: ['files'], bind: '127.0.0.1', port: 0, log: () => {} }), e => e.code === 'revoked', 'a restart does not lend again');
  const lines = require('../modules/activity').list({ limit: 50 });
  assert.ok(lines.some(l => l.from === 'mcp' && /removed .*hosted by laptop/.test(l.what)), 'the hub says what it stopped');
});

test('a revoke from another process (npm run token -- revoke) is seen when the file is next read', async () => {
  const devices = require('../modules/api-v1/devices');
  const reg = require('../modules/mcp/registry');
  const { device } = devices.create({ name: 'other', scopes: ['mcp:self'] });
  reg.upsert({ label: 'other (doca-client)', transport: 'http', url: 'http://127.0.0.1:9/mcp', origin: { kind: 'client', deviceId: device.id } });
  assert.ok(reg.forDevice(device.id));
  // What the CLI does: its own copy of the registry writes the file; this process has not read it since.
  const file = path.join(require('../modules/api-v1/store').DATA_DIR, 'devices.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  doc.devices[device.id].revokedAt = new Date().toISOString(); doc.devices[device.id].tokenHash = 'revoked';
  await H.sleep(20);   // a later mtime
  fs.writeFileSync(file, JSON.stringify(doc));
  assert.ok(devices.get(device.id).revokedAt, 'read again, as any request or turn step reads it');
  let gone = false;
  for (let i = 0; i < 100 && !gone; i++) { await H.sleep(20); gone = !reg.forDevice(device.id); }
  assert.ok(gone, 'and removed once the reload announces it');
});
