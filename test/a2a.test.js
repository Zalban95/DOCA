'use strict';

// DOCA as an A2A agent (modules/api-v1/a2a.js, TODO H9.2): the public agent card, message/send as a device's turn
// against a scripted model, contexts as conversations, tasks/get and tasks/cancel.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');

let server, script = [], phone, viewer, slow = 0;
const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };

before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => setTimeout(() => sse([{ choices: [{ delta: { content: (script.shift() || { text: 'done' }).text } }] }])(res), slow));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { bstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'bstub', model: 'm', fallbackChain: [], summarizeAfter: 0 });
  phone = H.mkDevice('Another agent', 'phone', H.PHONE_CAPS);
  require('../modules/api-v1/devices').update(phone.device.id, { userId: H.owner.user.id });
  viewer = H.mkDevice('Viewer', 'viewer', {});
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

const rpc = async (method, params, token = phone.token) => (await fetch(`${H.base}/api/v1/a2a`, { method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
const msg = (text, extra = {}) => ({ message: { kind: 'message', role: 'user', messageId: `m${Math.random()}`, parts: [{ kind: 'text', text }], ...extra } });

test('the agent card is public and says where to talk and how to authenticate', async () => {
  for (const p of ['/.well-known/agent-card.json', '/.well-known/agent.json']) {
    const r = await fetch(`${H.base}${p}`);   // no cookie, no token
    assert.equal(r.status, 200, p);
    const card = await r.json();
    assert.equal(card.protocolVersion, '0.3.0');
    assert.match(card.url, /\/api\/v1\/a2a$/);
    assert.equal(card.preferredTransport, 'JSONRPC');
    assert.deepEqual(card.security, [{ bearer: [] }]);
    assert.equal(card.capabilities.streaming, false);
    assert.ok(card.skills.length);
  }
});

test('message/send is a turn as the device: the Task comes back completed with the answer', async () => {
  script = [{ text: 'Three services are running.' }];
  const r = await rpc('message/send', msg('What is running?'));
  assert.equal(r.result.kind, 'task', JSON.stringify(r));
  assert.equal(r.result.status.state, 'completed');
  assert.equal(r.result.status.message.parts[0].text, 'Three services are running.');
  assert.equal(r.result.artifacts[0].parts[0].text, 'Three services are running.');
  const conv = r.result.contextId;
  assert.equal(require('../modules/harness/memory').getSession(conv).person?.id, H.owner.user.id);
  script = [{ text: 'Same context.' }];
  const again = await rpc('message/send', msg('And?', { contextId: conv }));
  assert.equal(again.result.contextId, conv, 'a context is a conversation');
  script = [{ text: 'Mapped.' }, { text: 'Mapped again.' }];
  const a = await rpc('message/send', msg('Hi', { contextId: 'ctx-from-elsewhere' }));
  const b = await rpc('message/send', msg('Hi again', { contextId: 'ctx-from-elsewhere' }));
  assert.equal(a.result.contextId, b.result.contextId, 'a foreign context id maps to the same conversation every time');
  assert.equal((await rpc('tasks/get', { id: r.result.id })).result.status.state, 'completed');
});

test('non-blocking: the Task is working at once, then read with tasks/get; a finished task cannot be canceled', async () => {
  slow = 400;
  try {
    script = [{ text: 'Later.' }];
    const r = await rpc('message/send', { ...msg('Take your time'), configuration: { blocking: false } });
    assert.equal(r.result.status.state, 'working');
    let t;
    for (let i = 0; i < 50; i++) { t = (await rpc('tasks/get', { id: r.result.id })).result; if (t.status.state !== 'working') break; await new Promise(x => setTimeout(x, 100)); }
    assert.equal(t.status.state, 'completed');
    assert.equal((await rpc('tasks/cancel', { id: r.result.id })).error.code, -32002);
  } finally { slow = 0; }
});

test('refusals are JSON-RPC errors: no scope, no text, an unknown task or method', async () => {
  assert.equal((await rpc('message/send', msg('hi'), viewer.token)).error.code, -32001);
  assert.equal((await rpc('message/send', { message: { role: 'user', parts: [{ kind: 'file', file: {} }] } })).error.code, -32602);
  assert.equal((await rpc('tasks/get', { id: 'nope' })).error.code, -32001);
  assert.equal((await rpc('message/stream', msg('hi'))).error.code, -32601);
});
