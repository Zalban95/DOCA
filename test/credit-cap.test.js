'use strict';

// OpenRouter checks the credit for a reply's whole cap up front: Opus 5.5 with a 128000-token cap was refused with
// HTTP 402 "You requested up to 128000 tokens, but can only afford 9070" (routing set, 2026-10-17), and every case of
// the run failed. The request is sent once more with the cap that can be paid; any other 402 is not retried here.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const fs = require('node:fs');
const http = require('node:http');

let server, seen = [];
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'dear' }] })); }
      const body = JSON.parse(raw); seen.push(body);
      const cap = body.max_tokens ?? body.max_completion_tokens;
      if (body.model === 'broke') { res.writeHead(402, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Insufficient credits. Add more using https://openrouter.ai/settings/credits', code: 402 } })); }
      if (cap > 9070) { res.writeHead(402, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: `This request requires more credits, or fewer max_tokens. You requested up to ${cap} tokens, but can only afford 9070.`, code: 402 } })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Paid for.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...cfg, models: { providers: { ...(cfg.models?.providers || {}), creditstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

test('a credit refusal naming what can be paid is sent again with that cap; an empty balance is not', async () => {
  assert.equal(require('../modules/harness/contracts').affordableFrom('… You requested up to 128000 tokens, but can only afford 9070.'), 9070);
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'creditstub', model: 'dear', maxTokens: 128000, maxSteps: 2, fallbackChain: [], contextWindow: 0 });
  const memory = require('../modules/harness/memory');
  seen = [];
  const r = await require('../modules/harness/agent').turn({ message: 'hello', sessionId: memory.createSession('credit', { activate: false }).id });
  assert.equal(r.text, 'Paid for.');
  const caps = seen.map(b => b.max_tokens ?? b.max_completion_tokens);
  assert.ok(caps[0] > 9070 && caps[1] <= 9070 && caps[1] >= 8000, `refused once, then asked within what can be paid: ${caps}`);
  assert.equal(require('../modules/harness/contracts').forProvider('creditstub', 'dear').maxOutput, undefined, 'never learned: credit moves');

  require('../modules/harness/catalog').saveConfig('doca', { provider: 'creditstub', model: 'broke', maxTokens: 128000, maxSteps: 2, fallbackChain: [], contextWindow: 0 });
  seen = [];
  await assert.rejects(require('../modules/harness/agent').turn({ message: 'hello', sessionId: memory.createSession('broke', { activate: false }).id }), /402/);
  assert.equal(seen.length, 1, 'no retry without a number to retry with');
});
