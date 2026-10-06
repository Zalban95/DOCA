'use strict';

// No secret leaves in a read of prefs (modules/secrets-mask.js, live test 2026-10-04: the HF token did).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { loadPrefs, savePrefs, loadModelsPrefs } = require('../modules/utils');
const { MASK } = require('../modules/secrets-mask');

let member;
before(async () => {
  await H.start();
  member = await H.signIn('member');
  savePrefs({ ...loadPrefs(), models: { ollamaUrl: 'http://x', hf: { cacheDir: '/c', token: 'hf_secret' } },
    mcpServers: { s1: { command: 'node', env: { BLENDER_AUTH: 'abc' }, headers: { Authorization: 'Bearer z' } } } });
});
after(() => H.stop());

test('reads mask the token, an MCP server\'s env and headers; everything else is as stored', async () => {
  const p = (await H.api(null, 'GET', '/api/prefs', undefined, { Cookie: member.cookie })).body;
  assert.equal(p.models.hf.token, MASK);
  assert.equal(p.models.hf.cacheDir, '/c');
  assert.equal(p.mcpServers.s1.env.BLENDER_AUTH, MASK);
  assert.equal(p.mcpServers.s1.headers.Authorization, MASK);
  assert.equal(p.mcpServers.s1.command, 'node');
  assert.equal((await H.api(null, 'GET', '/api/models/settings')).body.hf.token, MASK);
  assert.equal((await H.api(null, 'GET', '/api/models/hf/settings')).body.token, MASK);
});

test('posting a read back unchanged keeps the real values; a new value replaces them', async () => {
  const cur = (await H.api(null, 'GET', '/api/models/settings')).body;
  assert.equal((await H.api(null, 'POST', '/api/models/settings', { ...cur, ollamaUrl: 'http://y' })).status, 200);
  assert.equal(loadModelsPrefs().hf.token, 'hf_secret');
  assert.equal(loadPrefs().models.ollamaUrl, 'http://y');
  await H.api(null, 'POST', '/api/models/hf/settings', { cacheDir: '/c', token: MASK });
  assert.equal(loadModelsPrefs().hf.token, 'hf_secret');
  await H.api(null, 'POST', '/api/models/hf/settings', { cacheDir: '/c', token: 'hf_new' });
  assert.equal(loadModelsPrefs().hf.token, 'hf_new');
  assert.equal(loadPrefs().models.hf.token, undefined, 'kept in the protected keys, not the settings file (hf-token.js)');
  const all = (await H.api(null, 'GET', '/api/prefs')).body;
  await H.api(null, 'POST', '/api/prefs', { mcpServers: all.mcpServers });
  assert.equal(loadPrefs().mcpServers.s1.env.BLENDER_AUTH, 'abc');
});
