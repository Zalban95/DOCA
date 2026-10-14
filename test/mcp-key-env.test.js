'use strict';

// A command server's secrets as keys for services (modules/mcp/key-env.js): `keyEnv` names the keys, the hub fills the
// environment as it spawns the server, and neither the prefs file nor GET /api/mcp ever holds the value.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const H = require('./helpers');

const STUB = path.join(__dirname, 'fixtures', 'mcp-stub-server.js');
const SECRET = 'tok-key-env-0123456789';

before(H.start);
after(async () => { require('../modules/mcp/registry').stopAll(); await H.stop(); });

test('keyEnv is stored as names, filled from a key for services at start, and never shown', async () => {
  require('../modules/service-keys').save({ name: 'stub-svc', origin: 'https://api.example.com', key: SECRET });
  const saved = await H.api(null, 'POST', '/api/mcp', { label: 'Key Env Stub', command: process.execPath, args: [STUB], keyEnv: 'STUB_TOKEN=Stub-Svc' });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.server.keyEnv, { STUB_TOKEN: 'stub-svc' });
  const reg = require('../modules/mcp/registry');
  assert.deepEqual(reg.get('key-env-stub').env, {}, 'nothing secret in the definition');
  assert.ok(!fs.readFileSync(process.env.DOCA_PREFS_FILE, 'utf8').includes(SECRET), 'the prefs file never holds it');

  const c = await reg.start('key-env-stub');
  assert.equal(c.state, 'running');
  if (process.platform === 'linux') {
    const environ = fs.readFileSync(`/proc/${c.child.pid}/environ`, 'utf8').split('\0');
    assert.ok(environ.includes(`STUB_TOKEN=${SECRET}`), 'the server sees the key in its environment');
  }
  const listed = (await H.api(null, 'GET', '/api/mcp')).body.servers.find(s => s.id === 'key-env-stub');
  assert.ok(!JSON.stringify(listed).includes(SECRET), 'GET /api/mcp shows the names, never the value');
  assert.deepEqual(listed.keyEnv, { STUB_TOKEN: 'stub-svc' });
  reg.stop('key-env-stub');

  // Left out on a later save it stays; an empty value takes it off.
  await H.api(null, 'POST', '/api/mcp', { id: 'key-env-stub', label: 'Key Env Stub', command: process.execPath, args: [STUB] });
  assert.deepEqual(reg.get('key-env-stub').keyEnv, { STUB_TOKEN: 'stub-svc' });
  await H.api(null, 'POST', '/api/mcp', { id: 'key-env-stub', label: 'Key Env Stub', command: process.execPath, args: [STUB], keyEnv: '' });
  assert.equal(reg.get('key-env-stub').keyEnv, undefined);
});

test('a missing key refuses the start by name; a malformed line is refused, not dropped', async () => {
  const reg = require('../modules/mcp/registry');
  await H.api(null, 'POST', '/api/mcp', { label: 'No Key Stub', command: process.execPath, args: [STUB], keyEnv: { API_TOKEN: 'not-kept' } });
  await assert.rejects(reg.start('no-key-stub'), /"not-kept".*Keys for services/);
  const bad = await H.api(null, 'POST', '/api/mcp', { label: 'Bad', command: process.execPath, keyEnv: '1BAD=x' });
  assert.equal(bad.status, 400);
});

test('an address server ignores keyEnv: its key goes only to its own origin (withKey)', () => {
  const ke = require('../modules/mcp/key-env');
  const spec = { transport: 'http', url: 'https://api.example.com/mcp', keyEnv: { X: 'stub-svc' }, env: {} };
  assert.equal(ke.apply(spec), spec);
});
