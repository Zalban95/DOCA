'use strict';

// doca-client's families beyond files and shell (clients/node/families.js, TODO H6.6), on whichever OS runs this:
// what every machine has works, what a headless runner may lack (a screen, a clipboard) answers with what is
// missing rather than hanging or lying, and a picture travels as MCP image content.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { spawn } = require('node:child_process');

const client = require('../clients/node/doca-client');
const T = client.TOOLS;
const cfg = { root: os.tmpdir(), grants: { files: true, screen: true, processes: true, apps: true, device: true }, secret: 's3cret', name: 't' };

test('the new families are asked for like the first two', () => {
  assert.deepEqual(client.FAMILIES, ['files', 'shell', 'screen', 'processes', 'apps', 'device']);
  for (const n of ['screen_capture', 'processes_list', 'processes_stop', 'apps_open', 'device_info', 'device_notify', 'device_clipboard_read', 'device_clipboard_write'])
    assert.ok(T[n] && client.FAMILIES.includes(T[n].family) && T[n].description, n);
});

test('device_info and processes_list answer on every OS', async () => {
  const info = await T.device_info.run(cfg, {});
  assert.equal(info.platform, process.platform);
  assert.ok(info.cpus > 0 && info.memoryGB >= 0);
  const { processes } = await T.processes_list.run(cfg, {});
  assert.ok(Array.isArray(processes) && processes.length > 0, 'something is running');
});

test('processes_stop stops a program by pid', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  const gone = new Promise(r => child.on('exit', r));
  assert.deepEqual(await T.processes_stop.run(cfg, { pid: child.pid }), { ok: true, pid: child.pid });
  await gone;
});

test('apps_open opens only a web address or a file inside the shared home', async () => {
  await assert.rejects(() => T.apps_open.run(cfg, { target: os.platform() === 'win32' ? 'C:\\Windows\\System32\\calc.exe' : '/etc/passwd' }), /outside what this machine shares/);
});

test('a screen capture is a picture, or says what is missing', async () => {
  try {
    const r = await T.screen_capture.run(cfg, {});
    assert.equal(r.image.mimeType, 'image/png');
    assert.ok(Buffer.from(r.image.data, 'base64').subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'a PNG');
  } catch (e) { assert.match(e.message, /No picture of the screen/); }
});

test('a picture reaches the hub as MCP image content', async () => {
  T.test_picture = { family: 'files', description: 'test', input: {}, run: () => ({ image: { data: 'iVBORw0KGgo=', mimeType: 'image/png' }, note: 'x' }) };
  const server = await client.serve(cfg, { bind: '127.0.0.1', port: 0 });
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { Authorization: 'Bearer s3cret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'test_picture', arguments: {} } }) });
    const { result } = await r.json();
    assert.deepEqual(result.content[0], { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' });
    assert.deepEqual(JSON.parse(result.content[1].text), { note: 'x' });
  } finally { server.close(); delete T.test_picture; }
});

test('pairing takes the panel\'s link in one step', () => {
  assert.deepEqual(client.fromLink('doca://pair?code=641598&host=hub.tail1234.ts.net:4242'), { hub: 'https://hub.tail1234.ts.net:4242', code: '641-598' });
  assert.deepEqual(client.fromLink('https://hub:4242', '641-598'), { hub: 'https://hub:4242', code: '641-598' }, 'the address and code still work');
});

test('find: every online tailnet peer that answers as a DOCA hub, by name', async () => {
  const https = require('node:https');
  const { generate } = require('selfsigned');
  const pems = await Promise.resolve(generate([{ name: 'commonName', value: 'localhost' }], { days: 1, keySize: 2048 }));
  const srv = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    res.writeHead(req.url === '/api/branding' ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ product: 'Acme Desk', panel: 'Acme Panel' }));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.DOCA_PORT = String(srv.address().port);
  delete require.cache[require.resolve('../clients/node/discover')];
  const discover = require('../clients/node/discover');
  try {
    const hubs = await discover.find({ peers: async () => [{ name: 'desk.tail.ts.net', ip: '127.0.0.1', online: true, self: false }, { name: 'nothing-here', ip: '127.0.0.2', online: true, self: false }] });
    assert.deepEqual(hubs, [{ name: 'desk.tail.ts.net', ip: '127.0.0.1', self: false, url: `https://desk.tail.ts.net:${srv.address().port}`, product: 'Acme Desk' }]);
    assert.equal(await discover.find({ peers: async () => null }), null, 'no Tailscale: said, not an empty list');
  } finally { srv.close(); delete process.env.DOCA_PORT; }
});

test('at boot: a systemd user unit, a launchd agent or a Task Scheduler entry, each running `run`', () => {
  const b = require('../clients/node/boot');
  const script = require('node:path').join(__dirname, '..', 'clients', 'node', 'doca-client.js');
  const unit = b.unit({ DOCA_CLIENT_DIR: '/srv/doca-client' });
  assert.match(unit, new RegExp(`^ExecStart=${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} run$`, 'm'));
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^Environment=DOCA_CLIENT_DIR=\/srv\/doca-client$/m);
  assert.match(unit, /^WantedBy=default\.target$/m);
  const plist = b.plist();
  assert.match(plist, /<key>Label<\/key><string>tech\.doca\.client<\/string>/);
  assert.ok(plist.includes(`<string>${script}</string><string>run</string>`));
  const args = b.schtasks();
  assert.deepEqual(args.slice(0, 6), ['/Create', '/TN', 'DOCA client', '/SC', 'ONLOGON', '/RL']);
  assert.equal(args.at(-1), `"${process.execPath}" "${script}" run`);
});
