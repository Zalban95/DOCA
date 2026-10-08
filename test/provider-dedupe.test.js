'use strict';

/**
 * One provider per address (deep test B, C3): "Connect and test" tests before it saves, and the copies older tries
 * left behind are merged once (migration 2.329-providers-merged, modules/provider-dedupe.js).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

const H = require('./helpers');
const dedupe = require('../modules/provider-dedupe');
const keys = require('../modules/provider-keys');
const providers = require('../modules/harness/providers');
const migrations = require('../modules/migrations');

let stub, stubUrl;
test.before(async () => {
  await H.start();
  // A server like llama.cpp: its models only under /v1.
  stub = http.createServer((q, r) => {
    if (q.url === '/v1/models') return r.end(JSON.stringify({ data: [{ id: 'qwen-a' }, { id: 'qwen-b' }] }));
    r.statusCode = 404; r.end('{}');
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;
});
test.after(async () => { stub.close(); await H.stop(); });

test('the plan keeps the provider the settings use, joins the models, and leaves keyed ones alone', () => {
  const list = {
    'My model at a': { baseUrl: 'http://a:8080/v1', apiKey: '', models: ['m1'] },
    'My model at a (2)': { baseUrl: 'http://a:8080/v1/', apiKey: '', models: ['m2', 'm1'] },
    'Hub llama': { baseUrl: 'HTTP://A:8080/v1', apiKey: '', models: [{ id: 'm3' }] },
    paid: { baseUrl: 'http://a:8080/v1', apiKey: 'sk-1', models: [] },
    other: { baseUrl: 'http://b/v1', apiKey: '', models: [] },
  };
  const prefs = { harness: { config: { doca: { provider: 'Hub llama', fallbackChain: [{ provider: 'My model at a (2)', model: 'm2' }] } } } };
  const { into, models } = dedupe.plan(list, prefs);
  assert.deepEqual(into, { 'My model at a': 'Hub llama', 'My model at a (2)': 'Hub llama' });
  assert.deepEqual(models['Hub llama'].map(m => m.id || m), ['m3', 'm1', 'm2']);
  assert.equal(dedupe.repoint(prefs, into), 1);
  assert.equal(prefs.harness.config.doca.fallbackChain[0].provider, 'Hub llama');
});

test('testing an address saves nothing, finds /v1, and names the provider already there', async () => {
  const before = Object.keys(keys.all()).length;
  let r = await H.api(null, 'POST', '/api/keys/test-provider', { baseUrl: stubUrl });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.baseUrl, `${stubUrl}/v1`);
  assert.deepEqual(r.body.models, ['qwen-a', 'qwen-b']);
  assert.equal(r.body.existing, null);
  assert.equal(Object.keys(keys.all()).length, before, 'nothing saved by a test');
  // An address nothing listens on: a sentence, not Node's own words.
  r = await H.api(null, 'POST', '/api/keys/test-provider', { baseUrl: 'http://127.0.0.1:59999/v1' });
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /nothing is listening/);
  keys.set('Mine', { baseUrl: `${stubUrl}/v1`, apiKey: '', models: [] });
  r = await H.api(null, 'POST', '/api/keys/test-provider', { baseUrl: `${stubUrl}/v1/` });
  assert.equal(r.body.existing, 'Mine');
  keys.remove('Mine');
});

test('the migration merges copies in the keys file, repoints the settings, and the old name still resolves', () => {
  keys.set('Copy one', { baseUrl: `${stubUrl}/v1`, apiKey: '', models: ['qwen-a'] });
  keys.set('Copy two', { baseUrl: `${stubUrl}/v1`, apiKey: '', models: ['qwen-b'] });
  const m = migrations.MIGRATIONS.find(x => x.id === '2.329-providers-merged');
  const { prefs, ran } = migrations.run({ assistant: { provider: 'Copy two' } }, [m]);
  assert.deepEqual(ran[0].changed.length, 1);
  const left = Object.keys(keys.all()).filter(id => id.startsWith('Copy'));
  assert.deepEqual(left, ['Copy two']);
  assert.deepEqual(keys.get('Copy two').models, ['qwen-b', 'qwen-a']);
  assert.equal(prefs.assistant.provider, 'Copy two');
  assert.equal(keys.resolve('Copy one'), 'Copy two');
  assert.equal(providers.endpoint('Copy one').baseUrl, `${stubUrl}/v1`);
  // Run again: nothing left to merge.
  assert.equal(dedupe.merge({}), false);
});
