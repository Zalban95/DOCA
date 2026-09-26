'use strict';

/**
 * ISSUES.md H-20: the context Ollama really serves a model with, measured from
 * its native API and said when the declared window is larger.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

const H = require('./helpers');
const oc = require('../modules/harness/ollama-context');

let stub, base;
test.before(async () => {
  stub = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [{ name: 'qwen3:8b', model: 'qwen3:8b', context_length: 4096 }] }));
      if (req.url === '/api/show') {
        const { model } = JSON.parse(b || '{}');
        if (model === 'tuned:1') return res.end(JSON.stringify({ parameters: 'temperature 0.7\nnum_ctx 16384', model_info: { 'llama.context_length': 131072 } }));
        return res.end(JSON.stringify({ parameters: '', model_info: { 'qwen3.context_length': 40960 } }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${stub.address().port}`;
  await H.start();
});
test.after(async () => { stub.close(); await H.stop(); });

test('a declared window larger than what Ollama loaded the model with is said, with what to do', async () => {
  const r = await oc.check('qwen3:8b', 32768, { base });
  assert.equal(r.effective, 4096);
  assert.equal(r.source, 'running');
  assert.equal(r.max, 40960);
  assert.equal(r.mismatch, true);
  assert.match(r.advice, /serves qwen3:8b with a context of 4096 tokens \(as loaded now\), but 32768 is declared/);
  assert.match(r.advice, /PARAMETER num_ctx 32768.*OLLAMA_CONTEXT_LENGTH.*up to 40960/);
});

test('a Modelfile\'s num_ctx counts when the model is not loaded; a smaller declaration is fine', async () => {
  const r = await oc.check('tuned:1', 8192, { base });
  assert.equal(r.effective, 16384);
  assert.equal(r.source, 'modelfile');
  assert.equal(r.mismatch, false);
  const unknown = await oc.check('nothing-here', 8192, { base: 'http://127.0.0.1:9' });
  assert.equal(unknown.effective, null, 'Ollama not answering: nothing claimed');
  assert.equal(unknown.mismatch, false);
});

test('a turn uses what Ollama really serves — for the main model and each Ollama fallback — and says so once', async () => {
  const { loadPrefs, savePrefs } = require('../modules/utils');
  const before = loadPrefs();
  savePrefs({ ...before, models: { ...(before.models || {}), ollamaUrl: base } });
  try {
    const { ollamaWindows } = require('../modules/harness/turn/prompt');
    const p = { provider: 'ollama', model: 'qwen3:8b', contextWindow: 32768,
      fallbackChain: [{ provider: 'ollama', model: 'qwen3:8b', contextWindow: 65536 }, { provider: 'openai', model: 'gpt', contextWindow: 128000 }, { provider: 'ollama', model: 'tuned:1', contextWindow: 8192 }] };
    const saved = p.fallbackChain;
    const note = await ollamaWindows(p);
    assert.equal(p.contextWindow, 4096, 'folding and the preflight reason with the served window');
    assert.equal(p.fallbackChain[0].contextWindow, 4096);
    assert.equal(p.fallbackChain[1].contextWindow, 128000, 'another provider is left alone');
    assert.equal(p.fallbackChain[2].contextWindow, 8192, 'a declaration within what is served is left alone');
    assert.equal(saved[0].contextWindow, 65536, 'the saved chain is not mutated');
    assert.match(note, /^# Context\n.*32768 is declared.*Tell the person once, then work within 4096\.\nFallback 1: .*65536 is declared/s);
  } finally { savePrefs(before); }
});
