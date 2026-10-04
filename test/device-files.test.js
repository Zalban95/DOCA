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

test('a device\'s file previews from …/raw with its own type, and downloads under its name (2026-10-04)', async () => {
  const base = `/api/devices/${dev.id}/files`;
  fs.writeFileSync(path.join(root, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(root, 'page.html'), '<script>x</script>');
  const get = url => fetch(`${H.base}${url}`, { headers: { Cookie: H.owner.cookie } });
  const raw = await get(`${base}/raw?path=${encodeURIComponent(path.join(root, 'pic.png'))}`);
  assert.equal(raw.status, 200);
  assert.equal(raw.headers.get('content-type'), 'image/png');
  assert.deepEqual([...Buffer.from(await raw.arrayBuffer())], [0x89, 0x50, 0x4e, 0x47]);
  const html = await get(`${base}/raw?path=${encodeURIComponent(path.join(root, 'page.html'))}`);
  assert.match(html.headers.get('content-security-policy') || '', /sandbox/, 'a page from a device runs no script either');
  const dl = await get(`${base}/download/notes.txt?path=${encodeURIComponent(path.join(root, 'notes.txt'))}`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-type'), /^text\/plain/);
  assert.match(dl.headers.get('content-disposition'), /filename="notes\.txt"; filename\*=UTF-8''notes\.txt/);
  const host = await get(`/api/files/download/notes.txt?path=${encodeURIComponent(path.join(root, 'notes.txt'))}`);
  assert.match(host.headers.get('content-disposition') || '', /notes\.txt/, 'the host\'s download answers the named URL too');
});
