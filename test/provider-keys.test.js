'use strict';

/**
 * DOCA's provider keys in DOCA's own file (modules/provider-keys.js), with
 * OpenClaw's config read when it exists and written only when OpenClaw is
 * installed.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H     = require('./helpers');
const paths = require('../modules/paths');
const keys  = require('../modules/provider-keys');
const { fmSafe } = require('../modules/utils');

test.before(() => H.start());
test.after(() => H.stop());

const compose = path.join(paths.COMPOSE_DIR, 'docker-compose.yml');
const openclaw = () => JSON.parse(fs.readFileSync(paths.CONFIG_PATH, 'utf8')).models.providers;

test('the first read copies OpenClaw\'s providers once; afterwards DOCA keeps its own, 0600, out of the file tools\' reach', () => {
  fs.writeFileSync(paths.CONFIG_PATH, JSON.stringify({ models: { providers: { groq: { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk-old' } } } }));
  assert.equal(keys.get('groq').apiKey, 'gsk-old');
  assert.ok(fs.existsSync(keys.FILE), 'copied into DOCA\'s own file');
  assert.equal(fs.statSync(keys.FILE).mode & 0o777, 0o600);
  assert.equal(fmSafe(keys.FILE), false, 'read_file cannot reach it');
  assert.ok(keys.FILE.startsWith(require('../modules/store').DATA_DIR), 'in the data folder, so a backup carries it');
});

test('without OpenClaw, OpenClaw\'s file is never written — and never created', () => {
  fs.rmSync(compose, { force: true });
  const before = fs.readFileSync(paths.CONFIG_PATH, 'utf8');
  keys.set('groq', { apiKey: 'gsk-new' });
  keys.set('mistral', { baseUrl: 'https://api.mistral.ai/v1', apiKey: 'm-1' });
  assert.equal(fs.readFileSync(paths.CONFIG_PATH, 'utf8'), before, 'untouched');
  assert.equal(keys.get('groq').apiKey, 'gsk-new', 'DOCA\'s entry wins over OpenClaw\'s');

  fs.rmSync(paths.CONFIG_PATH);
  keys.set('deepseek', { apiKey: 'd-1', baseUrl: 'https://api.deepseek.com/v1' });
  assert.equal(fs.existsSync(paths.CONFIG_PATH), false, 'no .openclaw file made for an install without OpenClaw');
  assert.equal(keys.get('mistral').apiKey, 'm-1');
});

test('with OpenClaw installed, its file is kept in agreement; a removal stays removed', () => {
  fs.writeFileSync(compose, 'services: {}\n');
  fs.writeFileSync(paths.CONFIG_PATH, JSON.stringify({ gateway: { token: 'keep me' }, models: { providers: { groq: { apiKey: 'gsk-old' } } } }));
  keys.set('groq', { apiKey: 'gsk-2' });
  assert.equal(openclaw().groq.apiKey, 'gsk-2', 'mirrored');
  assert.equal(JSON.parse(fs.readFileSync(paths.CONFIG_PATH, 'utf8')).gateway.token, 'keep me', 'the rest of OpenClaw\'s file is left alone');

  assert.equal(keys.remove('groq'), true);
  assert.equal(keys.get('groq'), null);
  assert.equal(openclaw().groq, undefined);

  // OpenClaw's file names it again (edited by hand, restored): DOCA remembers it removed it.
  fs.rmSync(compose);
  fs.writeFileSync(paths.CONFIG_PATH, JSON.stringify({ models: { providers: { groq: { apiKey: 'from-openclaw' } } } }));
  assert.equal(keys.get('groq'), null, 'not brought back');
  keys.set('groq', { apiKey: 'again' });
  assert.equal(keys.get('groq').apiKey, 'again', 'until it is added in DOCA again');
});

test('the routes and the harness read the same store', async () => {
  let r = await H.api(null, 'POST', '/api/keys/add-provider', { name: 'localai', baseUrl: 'http://127.0.0.1:8080/v1' });
  assert.equal(r.status, 200);
  r = await H.api(null, 'GET', '/api/keys');
  assert.ok(r.body.providers.localai);
  assert.equal(r.body.providers.mistral.apiKeyMasked, '••••••••', 'a short key is not shown at all');
  assert.equal(r.body.providers.deepseek.apiKeyMasked.includes('d-1'), false);
  assert.equal(require('../modules/harness/providers').endpoint('localai').baseUrl, 'http://127.0.0.1:8080/v1');
  r = await H.api(null, 'DELETE', '/api/keys/localai');
  assert.equal(r.status, 200);
  assert.equal((await H.api(null, 'DELETE', '/api/keys/localai')).status, 404);
});
