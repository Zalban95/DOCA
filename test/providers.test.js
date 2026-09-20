'use strict';

/**
 * Model providers: the known-endpoint presets behind Settings → API Keys and
 * the built-in harness's provider dropdown.
 *
 * `test/helpers.js` points CONFIG_PATH at a temp file, so these write real
 * provider entries without touching the developer's openclaw.json.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const providers = require('../modules/harness/providers');

before(H.start);
after(H.stop);

const get  = p => H.api(null, 'GET', p);
const post = (p, body) => H.api(null, 'POST', p, body);

test('the local runtimes are known endpoints, not something to type by hand', async () => {
  const { status, body } = await get('/api/keys');
  assert.equal(status, 200);

  const byId = Object.fromEntries(body.presets.map(p => [p.id, p]));
  for (const id of ['llamacpp', 'vllm', 'lmstudio']) {
    assert.ok(byId[id], `${id} should be offered`);
    assert.equal(byId[id].local, true, `${id} runs on this machine, so no key is expected`);
    assert.equal(byId[id].env, null);
  }
  // Hosted vendors keep their key-from-environment route.
  assert.equal(byId.mistral.local, false);
  assert.equal(byId.mistral.env, 'MISTRAL_API_KEY');
});

test('a known endpoint can be added by name alone, and answers on its own port', async () => {
  const added = await post('/api/keys/add-provider', { name: 'llamacpp' });
  assert.equal(added.status, 200);
  assert.equal(added.body.baseUrl, 'http://127.0.0.1:8080/v1');

  const { body } = await get('/api/keys');
  const p = body.providers.llamacpp;
  // No key, but nothing is missing: the card must not read as broken.
  assert.equal(p.hasKey, false);
  assert.equal(p.local, true);
  assert.equal(p.baseUrl, 'http://127.0.0.1:8080/v1');

  // Once configured it drops out of the "add these" shortcuts.
  assert.equal(body.presets.some(x => x.id === 'llamacpp'), true, 'still a known endpoint');
  assert.equal(providers.list().some(x => x.id === 'llamacpp' && x.hasKey), true,
    'and the harness dropdown offers it as usable without a key');
});

test('a local server on a non-default port is a saved base URL, not a code change', async () => {
  const moved = await post('/api/keys', { provider: 'llamacpp', baseUrl: 'http://127.0.0.1:9999/v1' });
  assert.equal(moved.status, 200);

  assert.equal(providers.endpoint('llamacpp').baseUrl, 'http://127.0.0.1:9999/v1');
  assert.equal((await get('/api/keys')).body.providers.llamacpp.baseUrl, 'http://127.0.0.1:9999/v1');

  // Saving nothing at all is a mistake worth reporting rather than a no-op.
  assert.equal((await post('/api/keys', { provider: 'llamacpp' })).status, 400);

  await H.api(null, 'DELETE', '/api/keys/llamacpp');
});

test('a provider nobody has heard of is still addable', async () => {
  const added = await post('/api/keys/add-provider', {
    name: 'my-own-thing', baseUrl: 'https://llm.example.com/v1', apiKey: 'sk-abcd1234',
  });
  assert.equal(added.status, 200);
  assert.equal(providers.endpoint('my-own-thing').baseUrl, 'https://llm.example.com/v1');
  assert.equal(providers.list().some(x => x.id === 'my-own-thing' && x.hasKey), true);

  // …and one with no URL and no preset to borrow from is not.
  assert.equal((await post('/api/keys/add-provider', { name: 'nowhere' })).status, 400);

  await H.api(null, 'DELETE', '/api/keys/my-own-thing');
});

test('llama.cpp instances start against a real file check', () => {
  // Regression guard: handleStart calls fs.existsSync on the model path, which
  // threw ReferenceError when the fs import was dropped as unused.
  //
  // The instance is created here rather than assumed. This used to name
  // `nemotron-cascade`, the hardcoded instance every empty install was seeded
  // with — so the guard was resting on the defect it sat next to, and went red
  // the moment that stopped being invented.
  const llamacpp = require('../modules/models-llamacpp');
  const calls = [];
  const res = {
    status(c) { calls.push(c); return this; },
    json(b)   { this.payload = b; return this; },
  };
  llamacpp.handleConfig(
    { body: { id: 'guard-inst', modelPath: '/nonexistent/model.gguf', port: 11498 } },
    { json: () => {}, status() { return this; } });

  llamacpp.handleStart({ body: { id: 'guard-inst' } }, res);
  assert.equal(calls[0], 400);
  assert.match(res.payload.error, /Model file not found/);

  llamacpp.handleDelete({ params: { id: 'guard-inst' } }, { json: () => {} });
});
