'use strict';

/**
 * A local model's own pace (harness/provider-pace.js, deep test A #7): connected through + Add provider or chosen for
 * the agent, a server on this machine is asked its size and given its own first-token wait and reply limit, in place of
 * the harness's defaults; a hosted provider is left alone; both are said where a person looks.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');   // first: it points the settings at a temporary folder

let server, bodies = [];
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/props') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ default_generation_settings: { n_ctx: 40960 }, total_slots: 1 })); }
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[{"id":"qwen"}]}'); }
    let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
      bodies.push(JSON.parse(raw || '{}'));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  await H.start();
});
after(async () => { await H.stop(); await new Promise(r => server.close(r)); });

const pace = () => require('../modules/harness/provider-pace');

test('the values follow what the server reports, within bounds', () => {
  assert.deepEqual(pace().valuesFor({ ctx: 40960, slots: 1 }), { firstTokenTimeoutMs: 265000, maxTokens: 10240 });
  assert.deepEqual(pace().valuesFor({ ctx: 4096, slots: 4 }), { firstTokenTimeoutMs: 120000, maxTokens: 8192 });
  assert.deepEqual(pace().valuesFor({ ctx: 262144 }), { firstTokenTimeoutMs: 600000, maxTokens: 16384 });
  assert.deepEqual(pace().valuesFor({}), { firstTokenTimeoutMs: 300000, maxTokens: 8192 });
});

test('+ Add provider asks a local llama.cpp its size, keeps its pace and shows it on its row', async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const r = await H.api(null, 'POST', '/api/keys/add-provider', { name: 'my-llama', baseUrl });
  assert.equal(r.status, 200);
  assert.equal(r.body.pace.firstTokenTimeoutMs, 265000);
  assert.equal(r.body.pace.maxTokens, 10240);
  assert.match(r.body.paceText, /4\.4 min .* 10240 tokens — from llama\.cpp \/props: 40960 tokens of context, 1 slot/);
  const keys = await H.api(null, 'GET', '/api/keys');
  assert.match(keys.body.providers['my-llama'].pace, /10240 tokens/);
});

test('a hosted provider gets no pace of its own', async () => {
  const r = await H.api(null, 'POST', '/api/keys/add-provider', { name: 'far-away', baseUrl: 'https://api.example.invalid/v1', apiKey: 'k' });
  assert.equal(r.status, 200);
  assert.equal(r.body.pace, undefined);
  assert.equal(pace().of('far-away'), null);
});

test('a turn on it waits and writes by its own pace in place of the defaults; a value the person set still wins', async () => {
  const set = await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'my-llama', model: 'qwen' });
  assert.equal(set.status, 200);
  assert.match(set.body.paceText || '', /10240 tokens/, 'said where the model was chosen');
  const p = require('../modules/harness/turn/params').turnParams();
  assert.deepEqual([p.firstTokenTimeoutMs, p.maxTokens], [265000, 10240]);
  bodies = [];
  const s = require('../modules/harness/memory').createSession('pace', { activate: false });
  await require('../modules/harness/agent').turn({ message: 'hello', sessionId: s.id, emit: () => {} });
  assert.equal(bodies.at(-1).max_tokens, 10240);
  await H.api(null, 'POST', '/api/harness/doca/config', { maxTokens: 4096 });
  const mine = require('../modules/harness/turn/params').turnParams();
  assert.deepEqual([mine.firstTokenTimeoutMs, mine.maxTokens], [265000, 4096], 'the person\'s own reply limit, the provider\'s wait');
  // Removing the provider forgets its pace.
  assert.equal((await H.api(null, 'DELETE', '/api/keys/my-llama')).status, 200);
  assert.equal(pace().of('my-llama'), null);
});
