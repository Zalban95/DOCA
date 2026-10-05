'use strict';

// Thinking effort (modules/harness/turn/effort.js): which setting wins, how each provider hears it, and a refusal that
// costs one retry and a lesson rather than a failed turn. And assistant mode's shape reaches the prompt.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');

let srv, bodies = [];
before(async () => {
  srv = http.createServer((req, res) => { let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
    const b = JSON.parse(raw); bodies.push(b);
    if (b.reasoning_effort) { res.writeHead(400); return res.end('{"error":{"message":"Unrecognized request argument supplied: reasoning_effort"}}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"choices":[{"message":{"content":"ok"}}]}');
  }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  await H.start();
});
after(async () => { await H.stop(); srv.close(); });

const effort = () => require('../modules/harness/turn/effort');

test('the conversation\'s level wins, then assistant mode\'s, then the harness\'s; nothing says, nothing is sent', () => {
  const e = effort();
  assert.deepEqual(e.levelFor({ session: { effort: 'high' }, client: { mode: 'assistant' } }), { level: 'high', from: 'this conversation' });
  assert.equal(e.levelFor({ session: {}, client: { mode: 'assistant' } }).level, 'low', 'assistant mode is quick by default');
  assert.equal(e.levelFor({ session: {}, client: { mode: 'call' }, p: {} }).level, null);
  assert.equal(e.levelFor({ session: { effort: 'default' }, client: {}, p: { effort: 'medium' } }).level, 'medium');
});

test('each provider hears it in its own dialect', () => {
  const e = effort();
  assert.deepEqual(e.fields('low', { id: 'openai', baseUrl: 'https://api.openai.com/v1' }), { reasoning_effort: 'low' });
  assert.deepEqual(e.fields('off', { id: 'openai', baseUrl: 'https://api.openai.com/v1' }), { reasoning_effort: 'minimal' });
  assert.deepEqual(e.fields('off', { id: 'deepseek', baseUrl: 'https://api.deepseek.com' }), { thinking: { type: 'disabled' } });
  assert.deepEqual(e.fields('high', { id: 'or', baseUrl: 'https://openrouter.ai/api/v1' }), { reasoning: { effort: 'high' } });
  assert.deepEqual(e.fields('off', { id: 'vllm', baseUrl: 'http://gpu:8000/v1' }), { chat_template_kwargs: { enable_thinking: false } });
  assert.deepEqual(e.fields(null, { id: 'openai' }), {});
});

test('a server that refuses the field is asked once more without it, and is never sent it again', async () => {
  const { post } = require('../modules/harness/turn/transport');
  const ep = { id: 'strict-local', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, label: 'strict' };
  bodies = [];
  const r = await post(ep, { model: 'm', messages: [], ...effort().fields('low', ep, 'm') }, undefined, {});
  assert.equal(r.status, 200);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].reasoning_effort, undefined);
  assert.equal(require('../modules/harness/contracts').forProvider('strict-local', 'm').effortField, 'none');
  assert.deepEqual(effort().fields('low', ep, 'm'), {}, 'learned: nothing is sent');
});

test('assistant mode answers in its own style; the agent can change a conversation\'s effort when asked', async () => {
  const client = require('../modules/harness/turn/client');
  const block = client.clientBlock({ name: 'Assistant mode (the face, spoken)', mode: 'assistant', effort: { level: 'low', from: 'assistant mode (assistant.effort)' } });
  assert.match(block, /one to three short spoken sentences/);
  assert.match(block, /Thinking effort: low \(from assistant mode/);
  const memory = require('../modules/harness/memory'), tools = require('../modules/harness/tools');
  const s = memory.createSession('effort test', { activate: false });
  assert.match(await tools.call('effort', { level: 'high' }, [], { sessionId: s.id }), /high in this conversation/);
  assert.equal(memory.getSession(s.id).effort, 'high');
  await tools.call('effort', { level: 'default' }, [], { sessionId: s.id });
  assert.equal(memory.getSession(s.id).effort, null);
  const r = await H.api(null, 'POST', '/api/assistant', { effort: 'off', model: 'small-fast' });
  assert.equal(r.body.effort, 'off'); assert.equal(r.body.model, 'small-fast');
  assert.equal((await H.api(null, 'POST', '/api/assistant', { effort: 'extreme' })).status, 400);
});

test('Home Assistant is in the MCP catalogue as a server at an address, added off with an empty token', async () => {
  const cat = require('../modules/mcp/catalog');
  assert.equal(cat.list().find(c => c.id === 'home-assistant').command, 'http://homeassistant.local:8123/api/mcp');
  const row = await cat.add('home-assistant');
  assert.equal(row.transport, 'http');
  assert.equal(row.autostart, false);
});
