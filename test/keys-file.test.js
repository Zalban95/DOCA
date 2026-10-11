'use strict';

/**
 * The keys folder's files survive a power cut (modules/keys-file.js). Found 2026-10-11: the keys for services were
 * left damaged by a power cut, read as "no keys", and the next key saved wrote a file holding only itself.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const kf = require('../modules/keys-file');

test.before(() => H.start());
test.after(() => H.stop());

const tmpFile = () => path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'keys-file-')), 'k.json');

test('a write is whole, leaves no temporary file and keeps the one it replaced', () => {
  const f = tmpFile();
  kf.write(f, { a: 1 });
  kf.write(f, { a: 2 });
  assert.deepEqual(kf.read(f), { a: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f + '.prev', 'utf8')), { a: 1 });
  assert.deepEqual(fs.readdirSync(path.dirname(f)).sort(), ['k.json', 'k.json.prev']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});

test('no file yet reads as empty', () => {
  assert.deepEqual(kf.read(tmpFile()), {});
});

test('a file left empty by a power cut falls back to its earlier copy and keeps the damaged one', () => {
  const f = tmpFile();
  kf.write(f, { a: 1 });
  kf.write(f, { a: 1, b: 2 });
  fs.writeFileSync(f, '');   // what a cut mid-write leaves
  assert.deepEqual(kf.read(f), { a: 1 });
  assert.ok(fs.readdirSync(path.dirname(f)).some(n => n.startsWith('k.json.damaged-')));
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { a: 1 });
});

test('a damaged file with no good copy refuses, and is never written over', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{"half');
  assert.throws(() => kf.read(f), e => e.code === 'keys_damaged');
  assert.equal(fs.readFileSync(f, 'utf8'), '{"half');
});

test('the incident: a key saved after the file was damaged keeps the others', () => {
  const keys = require('../modules/service-keys');
  const file = require('../modules/paths').SERVICE_KEYS_FILE;
  keys.save({ name: 'home-assistant', origin: 'http://homeassistant.local:8123', key: 'tok-ha' });
  keys.save({ name: 'other', origin: 'https://api.example.com', key: 'tok-other' });
  fs.writeFileSync(file, '');
  keys.save({ name: 'hi3d', origin: 'https://api.hitem3d.ai', key: 'tok-hi3d' });
  assert.deepEqual(keys.list().map(k => k.name).sort(), ['hi3d', 'home-assistant']);
  fs.writeFileSync(file, '');
  fs.writeFileSync(file + '.prev', '');
  assert.throws(() => keys.save({ name: 'x', origin: 'https://x.example.com', key: 'k' }), e => e.code === 'keys_damaged');
  assert.equal(fs.readFileSync(file, 'utf8'), '');
});
