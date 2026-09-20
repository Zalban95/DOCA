'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
require('./helpers'); // Isolated data, prefs and provider files.
const { CONFIG_PATH } = require('../modules/paths');
const agent = require('../modules/harness/agent');
const budget = require('../modules/harness/budget');
const catalog = require('../modules/harness/catalog');
const memory = require('../modules/harness/memory');
const missions = require('../modules/agents/missions');
const registry = require('../modules/agents/registry');
let server, seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      seen.push(body);
      if (body.model === 'stall') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': waiting\n\n');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Done.' } }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: {
    stub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` },
  } } }));
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
beforeEach(() => {
  seen = [];
  agent.forgetDegraded();
  catalog.saveConfig('doca', { provider: 'stub', model: 'primary', contextWindow: 0,
    maxTokens: 256, summarizeAfter: 0, fallbackChain: [], firstTokenTimeoutMs: 1000, failoverAfterMs: 100 });
});
const run = (message = 'hello', extra = {}) => agent.turn({ message,
  sessionId: memory.createSession('preflight test').id, ...extra });

test('a 50k-token request is refused locally for a declared 40960-token model', async () => {
  catalog.saveConfig('doca', { contextWindow: 40960 });
  await assert.rejects(run('x'.repeat(200000)), /stub \/ primary.*estimated.*40960-token.*harness\.config\.doca\.contextWindow/);
  assert.equal(seen.length, 0, 'an unusable request never reaches the provider');
});

test('specialists use their declared window and do not inherit a different model window', async () => {
  catalog.saveConfig('doca', { contextWindow: 1000000 });
  const profile = { id: 'small', model: 'small-model', contextWindow: 40960,
    systemPrompt: 'Do one thing.', tools: [], memory: false, environment: 'minimal' };
  await assert.rejects(run('x'.repeat(200000), { profile }), /small-model.*40960-token.*small agent definition contextWindow/);
  assert.equal(seen.length, 0);
  catalog.saveConfig('doca', { contextWindow: 1 });
  await run('hello', { profile: { ...profile, contextWindow: null } });
  assert.equal(seen[0].model, 'small-model', 'unknown specialist capacity is not the primary capacity');
});

test('dispatch records a named preflight refusal without contacting the model', async () => {
  registry.setEnabled(true);
  registry.save({ id: 'tiny', role: 'Do one thing.', tools: [], contextWindow: 1 });
  const mission = missions.dispatch({ agentId: 'tiny', task: 'hello' });
  for (let i = 0; i < 100 && missions.get(mission.id).state === 'running'; i++)
    await new Promise(resolve => setTimeout(resolve, 10));
  const result = missions.get(mission.id);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /stub \/ primary.*declared 1-token.*tiny agent definition/);
  assert.equal(seen.length, 0);
  registry.setEnabled(false);
});

test('a stalled primary skips an undersized fallback and announces the usable one', async () => {
  catalog.saveConfig('doca', { model: 'stall', contextWindow: 1000000, fallbackChain: [
    { provider: 'stub', model: 'too-small', contextWindow: 1 },
    { provider: 'stub', model: 'fits', contextWindow: 1000000 },
  ] });
  const events = [];
  const result = await run('hello', { emit: event => events.push(event) });
  assert.equal(result.text, 'Done.');
  assert.deepEqual(seen.map(r => r.model), ['stall', 'fits']);
  assert.match(events.find(e => e.kind === 'context-preflight').text, /too-small.*fallbackChain\[0\]/);
  assert.equal(events.find(e => e.type === 'failover').toModel, 'fits');
});

test('an unknown fallback window stays unknown and a context hop is announced', async () => {
  catalog.saveConfig('doca', { contextWindow: 1, fallbackChain: [{ provider: 'stub', model: 'unknown' }] });
  const events = [];
  await run('hello', { emit: event => events.push(event) });
  assert.deepEqual(seen.map(r => r.model), ['unknown']);
  assert.match(events.find(e => e.type === 'failover').text, /cannot fit.*continuing on stub \/ unknown/);
});

test('preflight includes schemas and reply reserve but does not tokenize image bytes', () => {
  const body = { messages: [{ role: 'user', content: 'hello' }],
    tools: [{ type: 'function', function: { name: 'large', description: 'x'.repeat(2000) } }], max_tokens: 100 };
  const prompt = budget.estimateRequest(body);
  assert.ok(prompt > 500);
  const rung = { provider: 'test', model: 'test', windowSetting: 'test setting', contextWindow: prompt + 100 };
  assert.equal(budget.preflight(body, rung), null);
  assert.match(budget.preflight(body, { ...rung, contextWindow: prompt + 99 }), /100 reserved for the reply/);
  assert.equal(budget.preflight(body, { ...rung, contextWindow: 0 }), null);
  const image = { messages: [{ role: 'user', content: [
    { type: 'text', text: 'hello' }, { type: 'image_url', image_url: { url: 'x'.repeat(200000) } },
  ] }] };
  assert.ok(budget.estimateRequest(image) < 20);
});
