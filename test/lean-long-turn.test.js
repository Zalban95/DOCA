'use strict';

// A long single turn stays near the per-step ceiling (turn/reasoning-resend.js, clear-results.js, step-ceiling.js).
// Task B of the test of 2026-10-16: 44 steps averaging 217k tokens a request, because a thinking model's reasoning —
// one step of it 526,577 characters — was echoed back whole on every later step, and nothing could clear it.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const memory = require('../modules/harness/memory');
const budget = require('../modules/harness/budget');
const { toApiMessages } = require('../modules/harness/turn/messages');

let server, seen = [], reply = () => ({ content: 'Fine.' });
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw);
      const fold = /^Merge the notes/.test(body.messages?.[0]?.content || '');
      if (!fold) seen.push(body);
      const message = fold ? { content: 'Earlier: work was done.\nTopics: work' } : reply(seen.length - 1, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { completion_tokens: 5 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...cfg, models: { providers: { ...(cfg.models?.providers || {}), thinkstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

const RUNAWAY = 'I weigh the clip once more ✓ '.repeat(18000);   // ~520k characters of one step's thinking

test('end to end: a 40-step turn of a thinking model stays bounded per step, and its long thinking can be read back', async () => {
  const catalog = require('../modules/harness/catalog');
  const N = 40;
  fs.writeFileSync(path.join(H.tmp, 'part.txt'), 'part ok');
  seen = [];
  reply = i => (i < N
    ? { content: '', reasoning_content: i === 2 ? RUNAWAY : `step ${i}: ${'considering the next check. '.repeat(120)}`,
      tool_calls: [{ id: `t${i}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: path.join(H.tmp, 'part.txt') }) } }] }
    : { content: 'Built and checked.' });
  catalog.saveConfig('doca', { provider: 'thinkstub', model: 'm', compactTokens: 500000, summarizeAfter: 0, contextWindow: 1000000, maxSteps: N + 2, fallbackChain: [], stepTokens: 30000, resultChars: 8000 });
  try {
    const s = memory.createSession('long thinking turn', { activate: false });
    const r = await require('../modules/harness/agent').turn({ message: 'build the bracket', sessionId: s.id, emit: () => {} });
    assert.equal(r.text, 'Built and checked.');
    assert.equal(seen.length, N + 1);
    const sizes = seen.map(b => budget.estimateRequest(b));
    const max = Math.max(...sizes.slice(3));
    assert.ok(max < 30000 * 1.25, `every step after the runaway thought stays near the ceiling (largest ${max}; sizes ${sizes.join(',')})`);
    // The field the provider asks for is still on every assistant message; the runaway one names the file holding it.
    const last = seen.at(-1).messages.filter(m => m.role === 'assistant');
    assert.ok(last.every(m => typeof m.reasoning_content === 'string' && m.reasoning_content.length > 0), 'reasoning_content still travels');
    const named = seen[3].messages.filter(m => m.role === 'assistant')[2].reasoning_content;
    const file = named.match(/shortened to save context: (\d+) characters in (\S+);/);
    assert.ok(file, 'the shortened thinking says where all of it is');
    assert.equal(fs.readFileSync(file[2], 'utf8'), RUNAWAY, 'and the file holds every character');
    assert.equal(memory.messages(s.id).filter(x => x.role === 'assistant')[2].reasoning.text, RUNAWAY, 'the stored row is untouched');
  } finally {
    catalog.saveConfig('doca', { compactTokens: 40000, summarizeAfter: 40, contextWindow: 0, maxSteps: 8, stepTokens: 60000, resultChars: 8000 });
  }
});

test('reasoning is re-sent whole when lean context is off, and only to the provider that wrote it', () => {
  const row = { role: 'assistant', content: '', at: '2026-10-16T00:00:00.000Z', reasoning: { provider: 'ds', text: 'r'.repeat(20000) } };
  const rows = [{ role: 'user', content: 'x' }, row];
  assert.equal(toApiMessages(rows, { sessionId: 's_think', provider: 'ds' })[1].reasoning_content.length, 20000);
  assert.ok(toApiMessages(rows, { sessionId: 's_think', provider: 'ds', resendChars: 8000 })[1].reasoning_content.length < 8500);
  assert.equal(toApiMessages(rows, { sessionId: 's_think', provider: 'other', resendChars: 8000 })[1].reasoning_content, undefined);
});

// Round 1 of 2026-10-16, #4/#12: lean context cleared the craft skills' reads mid-task, and the agent hunted for the
// scripts they named.
test('a skill this turn is following is never shortened or cleared; its read names its folder', () => {
  const clear = require('../modules/harness/turn/clear-results');
  const call = (id, name, args = {}) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const result = (id, name, content) => ({ role: 'tool', tool_call_id: id, name, content });
  const body = `# product-video\nThis skill's folder: /x/skills/product-video — the scripts and files it names are there; run them by that path.\n1. **Spec** write it.\n${'Use promo.js. '.repeat(1500)}`;
  const s = memory.createSession('following a skill', { activate: false });
  memory.append(s.id, { role: 'user', content: 'make the video' });
  memory.append(s.id, call('k', 'skill', { action: 'read', name: 'product-video' }));
  memory.append(s.id, result('k', 'skill', body));
  for (let i = 0; i < 6; i++) { memory.append(s.id, call(`c${i}`, 'shell')); memory.append(s.id, result(`c${i}`, 'shell', 'o'.repeat(5000))); }
  memory.append(s.id, call('z', 'shell'));
  assert.ok(clear.clearOld(s.id) > 0, 'other old results are cleared');
  const { rows, folded } = memory.window(s.id, 0);
  const sent = toApiMessages(clear.view(rows, folded, memory.getSession(s.id).clearedThrough, s.id), { sessionId: s.id, resendChars: 8000 });
  assert.equal(sent.find(m => m.role === 'tool' && m.name === 'skill').content, body, 'the skill read goes whole');
  assert.match(sent.find(m => m.tool_call_id === 'c0').content, /^\[cleared to save context/);

  const tool = require('../modules/harness/toolbox/skills').find(t => t.name === 'skill');
  const name = require('../modules/harness/skills').list()[0]?.name;
  if (name) assert.match(tool.run({ action: 'read', name }), /^# [\w.-]+\nThis skill's folder: \S+ — the scripts and files it names are there/);
});
