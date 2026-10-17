'use strict';

// "Longest reply" 0 is each model's own maximum (the owner, 2026-10-17: "set it to max and let it adapt; owners who want
// to limit it still can"): a request asks high and what is learned brings it down — a refusal naming the maximum (kept
// per model), a context-length refusal naming the room left (asked once). A number above 0 stays a fixed cap.

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
      if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [] })); }
      const body = JSON.parse(raw); seen.push(body);
      const cap = body.max_tokens ?? body.max_completion_tokens;
      const no = text => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: text } })); };
      if (body.model === 'small-out' && cap > 8192) return no('the valid range of max_tokens is [1, 8192]');
      if (body.model === 'small-window' && cap + 3000 > 8192) return no(`This model's maximum context length is 8192 tokens. However, you requested ${cap + 3000} tokens (3000 in the messages, ${cap} in the completion).`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Room enough.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...cfg, models: { providers: { ...(cfg.models?.providers || {}), capstub2: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

const turn = async (model, extra = {}) => {
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'capstub2', model, maxSteps: 2, fallbackChain: [], contextWindow: 0, maxTokens: 0, ...extra });
  seen = [];
  const memory = require('../modules/harness/memory');
  return require('../modules/harness/agent').turn({ message: 'hello', sessionId: memory.createSession(model, { activate: false }).id });
};
const caps = () => seen.map(b => b.max_tokens ?? b.max_completion_tokens);

test('0 is each model\'s own maximum: asked high, brought down by what the provider says, kept per model', async () => {
  const budget = require('../modules/harness/budget');
  assert.equal(require('../modules/harness/providers').defaultParams().maxTokens, 0, 'the default adapts');
  assert.equal(budget.replyCap({ maxTokens: 0 }), budget.REPLY_MAX);
  assert.equal(budget.replyCapWords({ maxTokens: 0 }), 'each model\'s own maximum');
  require('../modules/harness/contracts').forget('capstub2');
  assert.equal((await turn('small-out')).text, 'Room enough.');
  assert.deepEqual(caps(), [budget.REPLY_MAX, 8192], 'refused once, then the maximum it named');
  await turn('small-out');
  assert.deepEqual(caps(), [8192], 'learned: the next turn asks within it at once');
});

test('a context-length refusal is asked again with the room the window has left; a fixed cap stays fixed', async () => {
  assert.equal((await turn('small-window')).text, 'Room enough.');
  const c = caps();
  assert.ok(c[0] > 8192 && c[1] > 0 && c[1] <= 8192 - 3000, `the room left after the prompt: ${c}`);
  await turn('small-window', { maxTokens: 1000 });
  assert.deepEqual(caps(), [1000], 'an owner\'s cap is sent as it is');
});

test('each model\'s own maximum goes up to a learned maximum above the starting ask', async () => {
  const contracts = require('../modules/harness/contracts'), budget = require('../modules/harness/budget');
  contracts.learn('capstub2', 'big-out', { maxOutput: 393216 }, { perModel: true });
  await turn('big-out');
  assert.deepEqual(caps(), [393216], 'asked its own maximum, not the starting 262144');
  await turn('big-out', { maxTokens: 4000 });
  assert.deepEqual(caps(), [4000], 'an owner\'s cap is never raised');
  assert.equal(budget.REPLY_MAX, 262144);
});

