'use strict';

/**
 * A paired device's files through the Files tab's routes (modules/device-files.js),
 * carried out by the device's own files_* tools — only when granted and not revoked.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H       = require('./helpers');
const control = require('../modules/devices-control');
const stub    = require('./fixtures/mcp-device-files');

let dev, root, server;
test.before(async () => {
  await H.start();
  root = path.join(H.tmp, 'portal-home');
  fs.mkdirSync(path.join(root, 'Documents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes.txt'), 'written on portal');
  server = await stub.start(root);
  dev = H.mkDevice('portal', 'phone', { ...H.PHONE_CAPS, formFactor: 'desktop' }).device;
  const made = await H.api(null, 'POST', '/api/mcp', { label: 'Portal', transport: 'http', url: server.url, origin: { kind: 'client', deviceId: dev.id } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const id = made.body.server?.id || made.body.id || 'portal';
  const started = await H.api(null, 'POST', `/api/mcp/${id}/action`, { action: 'start' });
  assert.equal(started.body.ok, true, JSON.stringify(started.body));
});
test.after(async () => { await server.close(); await H.stop(); });

test('nothing reaches a device\'s disk until it grants files, and a revoke stops it', async () => {
  const base = `/api/devices/${dev.id}/files`;
  assert.equal((await H.api(null, 'GET', `${base}/list?path=`)).status, 403, 'not granted');
  control.reportGrants(dev.id, { files: true });
  const list = await H.api(null, 'GET', `${base}/list?path=`);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.path, root);
  assert.deepEqual(list.body.entries.map(e => e.name).sort(), ['Documents', 'notes.txt']);
  control.send(dev.id, 'revoke', { family: 'files' });
  assert.equal((await H.api(null, 'GET', `${base}/list?path=`)).status, 403, 'revoked here');
  control.send(dev.id, 'restore', { family: 'files' });
});

test('read, write, move, copy, delete and download — the Files tab\'s own calls, on the device', async () => {
  const base = `/api/devices/${dev.id}/files`;
  assert.equal((await H.api(null, 'GET', `${base}/read?path=${encodeURIComponent(path.join(root, 'notes.txt'))}`)).body.content, 'written on portal');
  await H.api(null, 'POST', `${base}/write`, { path: path.join(root, 'new.md'), content: '# from DOCA' });
  assert.equal(fs.readFileSync(path.join(root, 'new.md'), 'utf8'), '# from DOCA');
  await H.api(null, 'POST', `${base}/rename`, { from: path.join(root, 'new.md'), to: path.join(root, 'Documents', 'new.md') });
  await H.api(null, 'POST', `${base}/paste`, { op: 'copy', paths: [path.join(root, 'notes.txt')], dest: path.join(root, 'Documents') });
  assert.deepEqual(fs.readdirSync(path.join(root, 'Documents')).sort(), ['new.md', 'notes.txt']);
  const dl = await H.api(null, 'GET', `${base}/download?path=${encodeURIComponent(path.join(root, 'notes.txt'))}`);
  assert.equal(Buffer.from(dl.body).toString(), 'written on portal');
  await H.api(null, 'POST', `${base}/delete`, { paths: [path.join(root, 'Documents', 'notes.txt')] });
  assert.deepEqual(fs.readdirSync(path.join(root, 'Documents')), ['new.md']);
  const outside = await H.api(null, 'GET', `${base}/read?path=${encodeURIComponent('/etc/passwd')}`);
  assert.equal(outside.status, 400, 'the device decides what it shares');
  assert.match(outside.body.error, /outside this device's shared folder/);
});
