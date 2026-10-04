'use strict';

// A model's window as its own server reports it, or nothing (modules/harness/context-window.js).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');
const cw = require('../modules/harness/context-window');

let server;
const routes = {
  '/vllm/v1/models': { data: [{ id: 'Qwen/Qwen3-32B', max_model_len: 32768 }] },
  '/router/v1/models': { data: [{ id: 'meta/llama', context_length: 131072, top_provider: { context_length: 65536 } }] },
  '/groq/v1/models': { data: [{ id: 'llama-3.3-70b', context_window: 128000 }] },
  '/llama/v1/models': { data: [{ id: 'local.gguf' }] },           // llama.cpp's list carries no window
  '/llama/props': { default_generation_settings: { n_ctx: 8192 } },
  '/lms/v1/models': { data: [{ id: 'qwen-7b' }] },
  '/lms/api/v0/models/qwen-7b': { id: 'qwen-7b', max_context_length: 32768, loaded_context_length: 4096 },
  '/plain/v1/models': { data: [{ id: 'gpt-x' }] },                // an OpenAI-shaped server that says nothing
};

before(async () => {
  server = http.createServer((req, res) => {
    const body = routes[req.url.split('?')[0]];
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body || { error: 'no' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const at = p => ({ baseUrl: `http://127.0.0.1:${server.address().port}/${p}/v1` });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: {
    vllm: at('vllm'), router: at('router'), groq: at('groq'), llama: at('llama'), lms: at('lms'), plain: at('plain'),
  } } }));
  await H.start();
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

test('each server\'s own field is read, and the source names the server and the field', async () => {
  const vllm = await cw.discover('vllm', 'Qwen/Qwen3-32B');
  assert.equal(vllm.tokens, 32768);
  assert.match(vllm.source, /^vLLM.* \/models, max_model_len$/, 'the provider by its label, and the field');
  assert.equal((await cw.discover('router', 'meta/llama')).tokens, 131072, 'the model\'s own length before a provider\'s');
  assert.equal((await cw.discover('groq', 'llama-3.3-70b')).tokens, 128000);
  const llama = await cw.discover('llama', 'local.gguf');
  assert.equal(llama.tokens, 8192);
  assert.match(llama.source, /llama\.cpp.*--ctx-size/);
  const lms = await cw.discover('lms', 'qwen-7b');
  assert.equal(lms.tokens, 4096, 'what LM Studio loaded it with, not the most it could');
  assert.match(lms.source, /LM Studio/);
});

test('a server that reports nothing gets null, never a guess from the model\'s name', async () => {
  assert.deepEqual(await cw.discover('plain', 'gpt-x'), { provider: 'plain', model: 'gpt-x', tokens: null, source: null, reached: true });
  assert.equal((await cw.discover('vllm', 'not-served')).tokens, null);
});

test('a server that does not answer is said to be unreachable, not to report nothing', async () => {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  cfg.models.providers.gone = { baseUrl: 'http://127.0.0.1:9/v1' };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg));
  const r = await cw.discover('gone', 'm');
  assert.equal(r.tokens, null);
  assert.equal(r.reached, false);
});

test('the route offers it, and writes nothing', async () => {
  const before = JSON.stringify(require('../modules/harness/catalog').configFor('doca'));
  const r = await H.api(null, 'GET', '/api/harness/context-window?provider=vllm&model=Qwen%2FQwen3-32B');
  assert.equal(r.status, 200);
  assert.equal(r.body.tokens, 32768);
  assert.equal(JSON.stringify(require('../modules/harness/catalog').configFor('doca')), before, 'the setting is untouched');
  const unknown = await H.api(null, 'GET', '/api/harness/context-window?provider=nope&model=x');
  assert.ok(unknown.status >= 400, 'a provider that is not configured is refused, not fetched');
});
