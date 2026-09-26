'use strict';

/**
 * A reply cut off at the length limit (finish_reason "length") is said, marked,
 * and not counted as a turn that did nothing (audit 2026-09-26, §4e).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

const H          = require('./helpers');
const memory     = require('../modules/harness/memory');
const supervisor = require('../modules/harness/supervisor');
const org        = require('../modules/harness/organization');

let stub, mode = 'stream';
test.before(async () => {
  stub = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'm' }] }));
      if (mode === 'json') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'The first half of' }, finish_reason: 'length' }] }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The first half of' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  await H.start();
  await H.api(null, 'POST', '/api/keys/add-provider', { name: 'cut', baseUrl: `http://127.0.0.1:${stub.address().port}/v1` });
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'cut', model: 'm', maxTokens: 64 });
});
test.after(async () => { stub.close(); supervisor._setEnabled(false); await H.stop(); });

async function turn(sessionId) {
  const res = await fetch(`${H.base}/api/harness/chat`, {
    method: 'POST', body: JSON.stringify({ message: 'Write a long essay.', sessionId }),
    headers: { 'Content-Type': 'application/json', Cookie: H.owner.cookie, 'Sec-Fetch-Site': 'same-origin' },
  });
  return (await res.text()).split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
}

for (const m of ['stream', 'json']) {
  test(`a ${m} reply stopped at the length limit is said and marked, not passed off as whole`, async () => {
    mode = m;
    const s = memory.createSession(`Cut ${m}`, { activate: false });
    const events = await turn(s.id);
    const warn = events.find(e => e.type === 'warning' && e.kind === 'truncated');
    assert.ok(warn, 'a warning the chat draws');
    assert.match(warn.text, /reached its length limit \(64 tokens, "Longest reply"/);
    const row = memory.messages(s.id).filter(r => r.role === 'assistant').at(-1);
    assert.equal(row.content, 'The first half of');
    assert.equal(row.truncated, true, 'the stored row says it is cut off');
  });
}

test('the supervisor does not count a cut-off turn as idle, and asks for the rest', async () => {
  supervisor._setEnabled(true);
  const woken = [];
  supervisor._setTurn(async (sessionId, message) => { woken.push(message); return { text: '' }; });
  const s = org.create({ title: 'Long answer' });
  memory.updateSession(s.id, { job: { state: 'working', autoTurns: 0, idleTurns: 2 } });
  assert.equal(supervisor.decide(s.id, { steps: 1, truncated: true }), 'woken');
  await new Promise(r => setImmediate(r));
  assert.equal(memory.getSession(s.id).job.idleTurns, 0, 'not a turn that did nothing');
  assert.equal(woken[0], supervisor.CUT_OFF);
});
