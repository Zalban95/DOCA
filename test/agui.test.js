'use strict';

// DOCA as an AG-UI agent (modules/api-v1/agui.js, TODO H9.2): RunAgentInput in, AG-UI's event stream out, as a
// paired device — checked against a scripted model that calls a tool and then answers.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');

let server, script = [], phone, viewer;
const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };

before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const next = script.shift() || { text: 'done' };
      if (next.tool) return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args) } }] } }] }])(res);
      return sse([{ choices: [{ delta: { content: next.text } }] }])(res);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { astub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'astub', model: 'm', fallbackChain: [], summarizeAfter: 0 });
  phone = H.mkDevice('AG-UI app', 'phone', H.PHONE_CAPS);
  require('../modules/api-v1/devices').update(phone.device.id, { userId: H.owner.user.id });
  viewer = H.mkDevice('Viewer', 'viewer', {});
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

async function run(body, token = phone.token) {
  const res = await fetch(`${H.base}/api/v1/agui`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body) });
  if (!res.headers.get('content-type')?.includes('event-stream')) return { status: res.status, body: await res.json() };
  const text = await res.text();
  return { status: res.status, events: text.split('\n\n').filter(Boolean).map(b => JSON.parse(b.replace(/^data: /, ''))) };
}

test('a run streams AG-UI events: started, the tool call and its result, the answer, finished', async () => {
  script = [{ tool: 'memory_search', args: { query: 'printer' } }, { text: 'Nothing about a printer yet.' }];
  const r = await run({ threadId: 'th-1', runId: 'run-1', messages: [{ id: 'u1', role: 'user', content: 'What do you know about my printer?' }] });
  assert.equal(r.status, 200);
  const types = r.events.map(e => e.type);
  assert.deepEqual(types, ['RUN_STARTED', 'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_RESULT',
    'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED'], JSON.stringify(r.events));
  const [started, call, args, , result, start, content, endText, finished] = r.events;
  assert.deepEqual(started, { type: 'RUN_STARTED', threadId: 'th-1', runId: 'run-1' });
  assert.equal(call.toolCallName, 'memory_search');
  assert.match(args.delta, /printer/);
  assert.equal(result.toolCallId, call.toolCallId, 'the result answers the call it belongs to');
  assert.equal(start.role, 'assistant');
  assert.equal(content.messageId, start.messageId);
  assert.equal(content.delta, 'Nothing about a printer yet.');
  assert.equal(endText.messageId, start.messageId);
  assert.equal(finished.threadId, 'th-1');
  assert.equal(finished.result.state, 'done');
  const conv = finished.result.conversation;
  assert.equal(require('../modules/harness/memory').getSession(conv).person?.id, H.owner.user.id, 'a conversation of the device\'s person');

  script = [{ text: 'Same thread.' }];
  const again = await run({ threadId: 'th-1', messages: [{ role: 'user', content: [{ type: 'text', text: 'And now?' }] }] });
  assert.equal(again.events.at(-1).result.conversation, conv, 'the same thread is the same conversation');
  script = [{ text: 'By id.' }];
  const byId = await run({ threadId: conv, messages: [{ role: 'user', content: 'Hi' }] });
  assert.equal(byId.events.at(-1).result.conversation, conv, 'a thread id that is a conversation id is that conversation');
});

test('the front end\'s own tools are said not to be used; a viewer cannot run; no user message is a 400', async () => {
  script = [{ text: 'ok' }];
  const r = await run({ threadId: 'th-2', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'confetti', description: 'x', parameters: {} }] });
  assert.deepEqual(r.events[1], { type: 'CUSTOM', name: 'doca.note', value: 'Not used by DOCA: the front end\'s own tools (the hive uses its own).' });
  assert.equal((await run({ messages: [{ role: 'user', content: 'hi' }] }, viewer.token)).status, 403);
  assert.equal((await run({ messages: [{ role: 'assistant', content: 'hi' }] })).status, 400);
});

test('a failed turn ends in RUN_ERROR', async () => {
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'astub', model: '', fallbackChain: [] });
  try {
    const r = await run({ threadId: 'th-3', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.events.at(-1).type, 'RUN_ERROR');
    assert.match(r.events.at(-1).message, /No model chosen/);
  } finally { require('../modules/harness/catalog').saveConfig('doca', { provider: 'astub', model: 'm', fallbackChain: [] }); }
});
