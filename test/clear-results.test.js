'use strict';

// Old tool results of the turn in progress, cleared from what is sent under token pressure (turn/clear-results.js).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const memory = require('../modules/harness/memory');
const clear = require('../modules/harness/turn/clear-results');
const { stepRequest } = require('../modules/harness/turn/step-request');
const providers = require('../modules/harness/providers');
const budget = require('../modules/harness/budget');

before(() => H.start());
after(() => H.stop());

/** One turn: a request, then `n` read_file calls each returning a large file. */
function bigTurn(n) {
  const s = memory.createSession('clear test', { activate: false });
  memory.append(s.id, { role: 'user', content: 'read them all' });
  for (let i = 0; i < n; i++) {
    memory.append(s.id, { role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read_file', arguments: `{"path":"f${i}"}` } }] });
    memory.append(s.id, { role: 'tool', tool_call_id: `c${i}`, name: 'read_file', content: `FILE${i} ` + 'x'.repeat(5000) });
  }
  memory.append(s.id, { role: 'assistant', content: '', tool_calls: [{ id: 'small', type: 'function', function: { name: 'list_dir', arguments: '{}' } }] });
  memory.append(s.id, { role: 'tool', tool_call_id: 'small', name: 'list_dir', content: 'a b c' });
  return s;
}

// Everything ahead of the per-step readings, which change every step by design (H-9): the cacheable part.
const prefix = msgs => JSON.stringify(msgs.filter(m => !(m.role === 'user' && String(m.content).startsWith('[panel readings'))));

function sent(s) {
  const p = { ...providers.defaultParams(), historyTurns: 0 };
  return stepRequest({ p, ep: { id: 'stub' }, message: 'read them all', summary: '', client: null, profile: null, projectBrief: '',
    schemas: [], disabled: [], session: memory.getSession(s.id), led: budget.ledger(), toolNews: '', contextSkips: new Map() }).messages;
}

test('all but the newest results are cleared from what is sent; the transcript keeps every byte', () => {
  const s = bigTurn(5);
  assert.equal(clear.clearOld(s.id), 2, 'five large results, three kept');
  const tools = sent(s).filter(m => m.role === 'tool');
  assert.equal(tools.length, 6, 'every call keeps its result row, so no pair is broken');
  assert.match(tools[0].content, /^\[cleared to save context: this read_file result \(5006 characters\)/);
  assert.match(tools[1].content, /^\[cleared to save context/);
  for (const i of [2, 3, 4]) assert.match(tools[i].content, new RegExp(`^FILE${i} x{5000}$`), `result ${i} is kept word for word`);
  assert.equal(tools[5].content, 'a b c', 'a short result is never touched');
  assert.ok(memory.messages(s.id).filter(r => r.role === 'tool').every(r => !String(r.content).startsWith('[cleared')),
    'the stored transcript is unchanged');
});

test('the mark only moves forward, so the prompt is stable between clears', () => {
  const s = bigTurn(4);
  assert.equal(clear.clearOld(s.id), 1);
  const first = prefix(sent(s));
  assert.equal(clear.clearOld(s.id), 0, 'nothing new to clear');
  assert.equal(prefix(sent(s)), first, 'byte-identical up to the readings: the provider cache survives');
  memory.append(s.id, { role: 'assistant', content: '', tool_calls: [{ id: 'n', type: 'function', function: { name: 'read_file', arguments: '{}' } }] });
  memory.append(s.id, { role: 'tool', tool_call_id: 'n', name: 'read_file', content: 'y'.repeat(3000) });
  assert.equal(clear.clearOld(s.id), 1, 'one more result past the newest three');
  assert.ok(memory.getSession(s.id).clearedThrough > 0);
});

test('three or fewer large results clear nothing, and a session from before this has no mark', () => {
  const s = bigTurn(3);
  assert.equal(clear.clearOld(s.id), 0);
  assert.equal(memory.getSession(s.id).clearedThrough, undefined, 'read-side default: an old session keeps loading');
  assert.ok(sent(s).filter(m => m.role === 'tool').every(m => !m.content.startsWith('[cleared')));
});

test('the agent is told in its limits that this happens and how to get a result back', () => {
  assert.match(budget.block(providers.defaultParams()), /tool results: .*over 1200 characters except your newest 3 are cleared.*run the tool again/);
});

test('end to end: a turn over compactTokens with nothing earlier to fold clears its own older results', async () => {
  const http = require('node:http');
  const fs = require('node:fs');
  const path = require('node:path');
  const catalog = require('../modules/harness/catalog');
  const { CONFIG_PATH } = require('../modules/paths');
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(H.tmp, `big${i}.txt`), `BIG${i} ` + 'z'.repeat(6000));
  const seen = [];
  let step = 0;
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      seen.push(JSON.parse(raw));
      const i = step++;
      const message = i < 5
        ? { content: '', tool_calls: [{ id: `r${i}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: path.join(H.tmp, `big${i}.txt`) }) } }] }
        : { content: 'Read all five.' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message, finish_reason: i < 5 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 2000 * (i + 1), completion_tokens: 5 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...cfg, models: { providers: { ...(cfg.models?.providers || {}), clearstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  catalog.saveConfig('doca', { provider: 'clearstub', model: 'm', compactTokens: 3000, summarizeAfter: 0, contextWindow: 0, maxSteps: 10, fallbackChain: [] });
  const events = [];
  try {
    const s = memory.createSession('e2e clear', { activate: false });
    const r = await require('../modules/harness/agent').turn({ message: 'read the five files', sessionId: s.id, emit: e => events.push(e) });
    assert.equal(r.text, 'Read all five.');
    const last = seen.at(-1).messages.filter(m => m.role === 'tool');
    assert.equal(last.length, 5);
    assert.match(last[0].content, /^\[cleared to save context/, 'the oldest result is not re-sent');
    assert.match(last[4].content, /BIG4/, 'the newest is');
    assert.ok(events.some(e => e.type === 'compacted' && e.cleared > 0), 'and the clear is announced');
  } finally {
    server.closeAllConnections(); await new Promise(r => server.close(r));
    catalog.saveConfig('doca', { compactTokens: 40000, maxSteps: 8 });
  }
});
