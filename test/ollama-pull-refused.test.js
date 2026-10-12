'use strict';

// A pull Ollama refuses (live check of the Library, 2026-10-12: "this model requires MLX support, but the MLX runtime
// is not available" for every EmbeddingGemma 2 tag on Linux) ends the stream as a failure with Ollama's own words —
// it used to end with "success", and the Library then saved a model that was not there.

const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const H = require('./helpers');

let stub;
test.before(async () => {
  await H.start();
  stub = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(req.url === '/api/pull' && /refused/.test(req.headers['x-test'] || 'refused')
      ? '{"status":"pulling manifest"}\n{"error":"this model requires MLX support, but the MLX runtime is not available"}\n'
      : '{"status":"success"}\n');
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  const { loadPrefs, savePrefs } = require('../modules/utils');
  const p = loadPrefs(); savePrefs({ ...p, models: { ...(p.models || {}), ollamaUrl: `http://127.0.0.1:${stub.address().port}` } });
});
test.after(async () => { stub.close(); await H.stop(); });

test('a refused pull ends as an error with Ollama\'s reason, never "success"', async () => {
  const r = await fetch(`${H.base}/api/models/ollama/pull`, { method: 'POST', headers: { Cookie: H.owner.cookie, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ name: 'embeddinggemma-2:740m-mxfp8' }) });
  const frames = (await r.text()).split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
  const last = frames.at(-1);
  assert.equal(last.done, true);
  assert.match(String(last.error), /requires MLX support/);
  assert.match(last.status, /^Error: /);
  assert.ok(!frames.some(f => f.status === 'success'), JSON.stringify(frames));
});
