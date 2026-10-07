'use strict';

// The Models tab's review notes, settled (2026-10-04): one storage card per folder, llama-servers running
// outside the panel shown, and Ollama's real search results instead of a fixed list.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

let llama;
before(async () => {
  await H.start();
  // A stand-in llama.cpp router, as the one on :8080 answers.
  llama = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.startsWith('/props')) return res.end(JSON.stringify({ role: 'router', build_info: 'b1-test', default_generation_settings: { n_ctx: 0 } }));
    if (req.url.startsWith('/v1/models') || req.url.startsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'qwen-test', status: { value: 'sleeping', args: ['llama-server', '--ctx-size', '40960'] } }] }));
    res.end('{}');
  });
  await new Promise(r => llama.listen(0, '127.0.0.1', r));
  require('../modules/provider-keys').set('llamacpp', { baseUrl: `http://127.0.0.1:${llama.address().port}/v1`, apiKey: '' });
});
after(async () => { llama.closeAllConnections(); await new Promise(r => llama.close(r)); await H.stop(); });

test('Ollama and HuggingFace in one folder are one storage card, not the same size twice', async () => {
  const dir = fs.mkdtempSync(path.join(H.tmp, 'models-'));
  const { loadModelsPrefs, saveModelsPrefs } = require('../modules/utils');
  saveModelsPrefs({ ...loadModelsPrefs(), ollamaPath: dir, hf: { cacheDir: dir, token: '' } });
  const disks = (await H.api(null, 'GET', '/api/models/disk?force=1')).body.disks;
  const at = disks.filter(d => d.path === dir);
  assert.equal(at.length, 1);
  assert.match(at[0].label, /Ollama models · HuggingFace cache/);
});

test('a llama-server the panel did not start is listed, with its models and context, read-only', async () => {
  const at = `http://127.0.0.1:${llama.address().port}`;
  // Found as a model server (model-servers.js, the default since TODO B6b): its models, their state and context.
  let list = (await H.api(null, 'GET', '/api/models/llamacpp/list')).body;
  let ext = list.external.find(e => e.url.startsWith(at));
  assert.ok(ext, JSON.stringify(list.external));
  assert.equal(ext.router, true);
  assert.deepEqual(ext.models, [{ id: 'qwen-test', state: 'sleeping', ctx: 40960 }]);
  // Found by its /props, the alternative kept beside it: its build too.
  const prefs = (await H.api(null, 'GET', '/api/prefs')).body;
  await H.api(null, 'POST', '/api/prefs', { llamacpp: { ...(prefs.llamacpp || {}), discovery: 'props' } });
  list = (await H.api(null, 'GET', '/api/models/llamacpp/list')).body;
  ext = list.external.find(e => e.build === 'b1-test');
  assert.ok(ext, JSON.stringify(list.external));
  assert.deepEqual(ext.models, [{ id: 'qwen-test', state: 'sleeping', ctx: 40960 }]);
  await H.api(null, 'POST', '/api/prefs', { llamacpp: { ...(prefs.llamacpp || {}), discovery: 'servers' } });
});

test('Ollama\'s search page becomes names, descriptions and tags', () => {
  const html = `<ul><li class="flex"><a href="/library/qwen3.8" class="group"><h2><span>qwen3.8</span></h2>
    <p class="max-w-lg break-words text-neutral-800 text-md">Qwen3.8 &amp; friends.</p>
    <span  class="inline-flex my-1 items-center">tools</span><span  class="inline-flex my-1">27b</span></a></li>
    <li class="flex"><a href="/library/qwen3-coder"><p class="max-w-lg break-words">Coder.</p></a></li></ul>`;
  const r = require('../modules/models-ollama').parseSearchPage(html);
  assert.deepEqual(r, [{ name: 'qwen3.8', description: 'Qwen3.8 & friends.', tags: ['tools', '27b'] }, { name: 'qwen3-coder', description: 'Coder.' }]);
});
