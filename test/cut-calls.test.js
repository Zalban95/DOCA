'use strict';

/**
 * A tool call cut off by the reply limit (deep test A, #2): asked again once with more room; still cut, it is stored
 * whole and answered "cut off, not run"; and a conversation that already holds a broken call heals on its next
 * request. The stub refuses, as llama.cpp does, any request carrying a call whose arguments do not parse.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const { CONFIG_PATH } = require('../modules/paths');

let model, seen = [], wholeAt = Infinity;
const CUT = '{"query":"mkdir -p ~/work/long && cd ~/work/long';
before(async () => {
  model = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[{"id":"local"}]}'); }
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      seen.push(body);
      for (const m of body.messages || []) for (const c of m.tool_calls || []) {
        try { JSON.parse(c.function.arguments || '{}'); } catch {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end('{"error":{"code":500,"message":"Failed to parse tool call arguments as JSON: missing closing quote"}}');
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const f = o => res.write(`data: ${JSON.stringify(o)}\n\n`);
      // The per-step readings may follow the last row, so "a result came back" is any tool row after the request.
      const asked = body.messages.findLastIndex(m => m.role === 'user' && /long folder|hello again/.test(m.content || ''));
      if (/hello again/.test(body.messages[asked]?.content || '') || body.messages.slice(asked).some(m => m.role === 'tool')) {
        f({ choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] });
      } else {
        const whole = body.max_tokens >= wholeAt;
        f({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${seen.length}`, function: { name: 'memory_search', arguments: whole ? '{"query":"long"}' : CUT } }] } }] });
        f({ choices: [{ delta: {}, finish_reason: whole ? 'tool_calls' : 'length' }] });
      }
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'k', models: ['local'] } } } }));
  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'local', maxTokens: 2048, maxSteps: 4 });
});
after(async () => { await H.stop(); await new Promise(r => model.close(r)); });

const memory = () => require('../modules/harness/memory');
const parses = s => { try { JSON.parse(s || '{}'); return true; } catch { return false; } };
async function turn(message, sessionId) {
  const s = sessionId || memory().createSession('cut', { activate: false }).id;
  const events = [];
  const out = await require('../modules/harness/agent').turn({ message, sessionId: s, emit: e => events.push(e) });
  return { out, events, id: s };
}

test('a call cut at the reply limit is asked once more with twice the room, and runs whole', async () => {
  seen = []; wholeAt = 4096;
  const { out, events, id } = await turn('make a long folder');
  assert.deepEqual(seen.slice(0, 2).map(b => b.max_tokens), [2048, 4096]);
  assert.match(events.find(e => e.kind === 'cut-call-retry')?.text || '', /reply limit \(2048 tokens.*memory_search call .*room for 4096/);
  assert.match(out.text, /Done\./);
  const calls = memory().messages(id).flatMap(r => r.tool_calls || []);
  assert.deepEqual(calls.map(c => c.function.arguments), ['{"query":"long"}']);
});

test('still cut: stored whole, answered as cut and not run, and the next request is accepted', async () => {
  seen = []; wholeAt = Infinity;
  const { out, id } = await turn('make a long folder');
  assert.match(out.text, /Done\./, 'the conversation goes on');
  const rows = memory().messages(id);
  const calls = rows.flatMap(r => r.tool_calls || []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.arguments, '{}', 'never stored as it came');
  const result = rows.find(r => r.role === 'tool');
  assert.match(result.content, /^Error: the "memory_search" call was cut off by the reply limit \(4096 tokens.*did not run/);
  assert.ok(result.failure, 'a failed step');
  // The conversation is alive: another turn there is sent and answered.
  const again = await turn('hello again', id);
  assert.match(again.out.text, /Done\./);
  assert.ok(seen.every(b => b.messages.every(m => (m.tool_calls || []).every(c => parses(c.function.arguments)))));
});

test('a conversation that already holds a broken call heals on its next request', async () => {
  seen = [];
  const id = memory().createSession('broken', { activate: false }).id;
  memory().append(id, { role: 'user', content: 'make a long folder' });
  memory().append(id, { role: 'assistant', content: '', tool_calls: [{ id: 'old1', type: 'function', function: { name: 'shell', arguments: CUT } }] });
  memory().append(id, { role: 'tool', tool_call_id: 'old1', name: 'shell', content: `Error: could not parse the arguments as JSON: ${CUT}` });
  const { out } = await turn('hello again', id);
  assert.match(out.text, /Done\./, 'answered, not a 500');
  const sent = seen[0].messages.find(m => m.tool_calls);
  assert.equal(sent.tool_calls[0].function.arguments, '{}');
  assert.ok(seen[0].messages.some(m => m.role === 'tool' && m.tool_call_id === 'old1'), 'its result still travels with it');
});
