'use strict';

// Lean context per step (turn/step-ceiling.js, clear-results.js, messages.js): a ceiling on what one step sends,
// results whole when they arrive and head + tail after, nothing lost.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const memory = require('../modules/harness/memory');
const clear = require('../modules/harness/turn/clear-results');
const { toApiMessages } = require('../modules/harness/turn/messages');
const ceiling = require('../modules/harness/turn/step-ceiling');
const providers = require('../modules/harness/providers');
const budget = require('../modules/harness/budget');

let model;   // one stub for the file: a provider's address is read once per process
before(async () => { await H.start(); model = await stubModel(); });
after(async () => { await model.close(); await H.stop(); });

const call = (id, name, args = {}) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const result = (id, name, content) => ({ role: 'tool', tool_call_id: id, name, content });

test('a result goes whole on the step it arrives, then as head + tail with the file holding all of it', () => {
  const big = Array.from({ length: 500 }, (_, i) => `line ${i} ${'x'.repeat(60)}`).join('\n');   // ~34k characters
  const step1 = [{ role: 'user', content: 'build it' }, call('a', 'shell'), result('a', 'shell', big)];
  const fresh = toApiMessages(step1, { sessionId: 's_lean', resendChars: 8000 }).find(m => m.role === 'tool').content;
  assert.equal(fresh, big, 'the agent receives the whole result the first time');

  const step2 = [...step1, call('b', 'shell'), result('b', 'shell', 'ok')];
  const again = toApiMessages(step2, { sessionId: 's_lean', resendChars: 8000 }).filter(m => m.role === 'tool');
  assert.ok(again[0].content.length < 9000, 'on a later step it is head + tail');
  assert.match(again[0].content, /^line 0 /);
  assert.match(again[0].content, /line 499 x+$/);
  const file = again[0].content.match(/full output: (.+?) — (\d+) characters, (\d+) lines/);
  assert.ok(file, 'the stub says where the whole result is and how big it is');
  assert.equal(fs.readFileSync(file[1], 'utf8'), big, 'and the file holds every character');
  assert.match(again[0].content, /read_file to retrieve the rest \(offset, maxLength\)/);

  // Fixed from then on: the prefix cache breaks once, at the newest results, never further up.
  const step3 = [...step2, call('c', 'shell'), result('c', 'shell', big)];
  assert.equal(toApiMessages(step3, { sessionId: 's_lean', resendChars: 8000 })[2].content, again[0].content);
});

test('a file the agent read keeps 16000 characters on re-sends; without resultChars the old clip stands', () => {
  const text = 'r'.repeat(14000);
  const rows = [{ role: 'user', content: 'read' }, call('a', 'read_file'), result('a', 'read_file', text), call('b', 'shell'), result('b', 'shell', 'ok')];
  assert.equal(toApiMessages(rows, { sessionId: 's_lean', resendChars: 8000 })[2].content, text);
  const old = toApiMessages([{ role: 'user', content: 'x' }, call('a', 'shell'), result('a', 'shell', 'y'.repeat(20000))], { sessionId: 's_lean' });
  assert.match(old[2].content, /full output:/, 'no resendChars: every result over 16000 is clipped, even fresh, as before');
});

test('a result the model has not read yet is never cleared, however many a step returns', () => {
  const s = memory.createSession('lean parallel', { activate: false });
  memory.append(s.id, { role: 'user', content: 'go' });
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
  memory.append(s.id, { role: 'assistant', content: '', tool_calls: ids.map(id => ({ id, type: 'function', function: { name: 'shell', arguments: '{}' } })) });
  for (const id of ids) memory.append(s.id, result(id, 'shell', 'z'.repeat(5000)));
  assert.equal(clear.clearOld(s.id), 0, 'five fresh results: none is cleared before the model sees it');
});

test('a long argument of an old call is left out of re-sends as valid JSON; the stored call keeps it', () => {
  const s = memory.createSession('lean args', { activate: false });
  memory.append(s.id, { role: 'user', content: 'write the parts' });
  for (let i = 0; i < 5; i++) {
    memory.append(s.id, call(`w${i}`, 'write_file', { path: `/tmp/p${i}.scad`, content: `// ${i}\n${'cube(1);\n'.repeat(300)}` }));
    memory.append(s.id, result(`w${i}`, 'write_file', 'Wrote it.'));
  }
  memory.append(s.id, call('last', 'list_dir'));
  memory.append(s.id, result('last', 'list_dir', 'a b'));
  assert.ok(clear.clearOld(s.id) > 0);
  const { rows, folded } = memory.window(s.id, 0);
  const sent = clear.view(rows, folded, memory.getSession(s.id).clearedThrough, s.id);
  const first = JSON.parse(sent[1].tool_calls[0].function.arguments);
  assert.equal(first.path, '/tmp/p0.scad', 'short values stay');
  assert.match(first.content, /^\[left out to save context: \d+ characters you sent here earlier/);
  assert.ok(memory.messages(s.id)[1].tool_calls[0].function.arguments.includes('cube(1);'), 'the stored transcript is untouched');
});

test('the agent is told the ceiling and how to read back what was shortened', () => {
  const block = budget.block(providers.defaultParams());
  assert.match(block, /per-step ceiling: 60000 tokens a request \(harness\.config\.doca\.stepTokens\)/);
  assert.match(block, /harness\.config\.doca\.resultChars/);
  assert.match(block, /read_file that path/);
  assert.match(budget.block({ ...providers.defaultParams(), stepTokens: 0 }), /per-step ceiling: off/);
});

/** A stub model whose replies are scripted; fold requests get a summary. */
async function stubModel() {
  const m = { seen: [], reply: () => ({ content: 'Fine.' }) };
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw);
      const fold = /^Merge the notes/.test(body.messages?.[0]?.content || '');
      if (!fold) m.seen.push(body);
      const message = fold ? { content: 'Earlier: big files were read.\nTopics: files' } : m.reply(m.seen.length - 1, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { completion_tokens: 5 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {};
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...cfg, models: { providers: { ...(cfg.models?.providers || {}), leanstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  m.use = reply => { m.seen = []; m.reply = reply; return m; };
  m.close = async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); };
  return m;
}

test('end to end: over stepTokens, older results are cleared before the step goes, with compactTokens out of reach', async () => {
  const catalog = require('../modules/harness/catalog');
  for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(H.tmp, `lean${i}.txt`), `LEAN${i} ` + 'q'.repeat(8000));
  const m = model.use(i => (i < 6
    ? { content: '', tool_calls: [{ id: `r${i}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: path.join(H.tmp, `lean${i}.txt`) }) } }] }
    : { content: 'Read all six.' }));
  catalog.saveConfig('doca', { provider: 'leanstub', model: 'm', compactTokens: 500000, summarizeAfter: 0, contextWindow: 1000000, maxSteps: 10, fallbackChain: [], stepTokens: 14000 });
  const events = [];
  try {
    const s = memory.createSession('lean e2e', { activate: false });
    const r = await require('../modules/harness/agent').turn({ message: 'read the six files', sessionId: s.id, emit: e => events.push(e) });
    assert.equal(r.text, 'Read all six.');
    const last = m.seen.at(-1).messages.filter(x => x.role === 'tool');
    assert.equal(last.length, 6, 'every result row still travels, so no pair is broken');
    assert.match(last[0].content, /^\[cleared to save context: .*read_file it/, 'the oldest is a stub naming its file');
    assert.match(last[5].content, /LEAN5 q{8000}\n/, 'the newest went whole');
    const ev = events.find(e => e.type === 'compacted' && e.setting === 'stepTokens');
    assert.ok(ev && ev.cleared > 0 && ev.threshold === 14000, 'and it is said, naming the setting');
  } finally {
    catalog.saveConfig('doca', { compactTokens: 40000, contextWindow: 0, maxSteps: 8, stepTokens: 60000 });
  }
});

test('end to end: a long conversation\'s new request starts lean — earlier results cleared, earlier turns folded', async () => {
  const catalog = require('../modules/harness/catalog');
  const s = memory.createSession('lean old', { activate: false });
  for (let t = 0; t < 4; t++) {
    memory.append(s.id, { role: 'user', content: `earlier task ${t}` });
    for (let i = 0; i < 3; i++) { memory.append(s.id, call(`o${t}${i}`, 'shell')); memory.append(s.id, result(`o${t}${i}`, 'shell', 'w'.repeat(6000))); }
    memory.append(s.id, { role: 'assistant', content: `done ${t}: ${'a long account of it. '.repeat(400)}` });   // not clearable: only a fold helps
  }
  const m = model.use(() => ({ content: 'Fine.' }));
  catalog.saveConfig('doca', { provider: 'leanstub', model: 'm', compactTokens: 500000, summarizeAfter: 800, historyTurns: 10000, contextWindow: 1000000, maxSteps: 4, fallbackChain: [], stepTokens: 25000 });
  const events = [];
  try {
    await require('../modules/harness/agent').turn({ message: 'a new small task', sessionId: s.id, emit: e => events.push(e) });
    const first = m.seen[0];
    assert.ok(budget.estimateRequest(first) < 25000, `the first step is under the ceiling (${budget.estimateRequest(first)})`);
    assert.ok(events.some(e => e.type === 'compacted' && e.setting === 'stepTokens' && e.target === 15000), 'shortened to 60% of the ceiling');
    assert.ok(memory.getSession(s.id).summarizedThrough > 0, 'earlier turns folded');
  } finally {
    catalog.saveConfig('doca', { compactTokens: 40000, summarizeAfter: 40, historyTurns: 24, contextWindow: 0, maxSteps: 8, stepTokens: 60000 });
  }
});

test('stepTokens 0 is the old behaviour: nothing is cleared or folded by the ceiling', async () => {
  const s = memory.createSession('lean off', { activate: false });
  memory.append(s.id, { role: 'user', content: 'x' });
  const built = [];
  const r = await ceiling.fit({ p: { stepTokens: 0 }, session: s, led: budget.ledger(), schemas: [], summary: '', build: sum => { built.push(sum); return { messages: [{ role: 'user', content: 'y'.repeat(900000) }] }; } });
  assert.equal(built.length, 1);
  assert.equal(r.summary, '');
  assert.equal(memory.getSession(s.id).clearedThrough, undefined);
});

test('the spill folder is kept to its bound: a deleted or long-unused conversation\'s goes, a used one stays, and comes back', () => {
  const keep = require('../modules/harness/spill-keep');
  const { spillTool } = require('../modules/harness/turn/messages');
  const live = memory.createSession('spill live', { activate: false });
  const idle = memory.createSession('spill idle', { activate: false });
  const row = { tool_call_id: 'x1', name: 'shell', content: 'whole text' };
  const a = spillTool(live.id, row), b = spillTool(idle.id, row), c = spillTool('s_gone_forever', row);
  const later = Date.now() + 20 * 86400000;
  memory.updateSession(live.id, { touched: true });
  assert.ok(keep.prune(14, Date.now()) >= 1);
  assert.ok(fs.existsSync(a) && fs.existsSync(b) && !fs.existsSync(c), 'today: only the folder of a conversation that does not exist goes');
  assert.ok(keep.prune(14, later) >= 2, 'twenty days on, folders of conversations unused for fourteen go');
  assert.ok(!fs.existsSync(a));
  assert.equal(spillTool(live.id, row), a, 'the next request writes it again from the stored row');
  assert.equal(fs.readFileSync(a, 'utf8'), 'whole text');
  const rows = require('../modules/log-keep').usage().stores;
  assert.ok(rows.some(r => r.id === 'tool-results' && r.settings[0].path === 'logs.toolResultsDays'), 'a row in Settings → System → Logs');
});

test('a trip shortens down to 60% of the ceiling, not just under it', () => {
  assert.equal(ceiling.LOW, 0.6);
  assert.match(budget.block(providers.defaultParams()), /shortened down to 60% of it/);
});

// Round 1 of the test of 2026-10-16: inside one long turn the ceiling cannot be reached (its own rows do not fold), and
// every step cleared one more result — sixteen `compacted` in a row, each a broken prompt cache.
test('end to end: a long turn that cannot get under the ceiling shortens a few times as it grows, not on every step', async () => {
  const catalog = require('../modules/harness/catalog');
  const N = 16;
  for (let i = 0; i < N; i++) fs.writeFileSync(path.join(H.tmp, `grow${i}.txt`), `GROW${i} ` + 'g'.repeat(8000));
  model.use(i => (i < N
    ? { content: '', tool_calls: [{ id: `g${i}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: path.join(H.tmp, `grow${i}.txt`) }) } }] }
    : { content: 'Read them all.' }));
  // The prompt and tool schemas alone are over 6000 tokens: no shortening can ever get this turn under the ceiling.
  catalog.saveConfig('doca', { provider: 'leanstub', model: 'm', compactTokens: 500000, summarizeAfter: 0, contextWindow: 1000000, maxSteps: N + 2, fallbackChain: [], stepTokens: 6000 });
  const events = [];
  try {
    const s = memory.createSession('lean grow', { activate: false });
    const r = await require('../modules/harness/agent').turn({ message: 'read the files', sessionId: s.id, emit: e => events.push(e) });
    assert.equal(r.text, 'Read them all.');
    const trips = events.filter(e => e.type === 'compacted' && e.setting === 'stepTokens');
    assert.ok(trips.length >= 1, 'it does shorten');
    assert.ok(trips.length <= 5, `a handful of times over ${N + 1} steps, not every step (${trips.length})`);
    for (let i = 1; i < trips.length; i++)
      assert.ok(trips[i].contextTokens >= trips[i - 1].after + Math.min(Math.round(trips[i - 1].after * ceiling.GROW), ceiling.GROW_TOKENS),
        'each try waits until the request has grown by a meaningful margin');
    const warned = events.filter(e => e.type === 'warning' && e.kind === 'step-ceiling');
    assert.equal(warned.length, 1, 'said once');
    assert.ok(memory.getSession(s.id).clearedThrough > 0, 'and what was cleared stays cleared (the mark only moves forward)');
  } finally {
    catalog.saveConfig('doca', { compactTokens: 40000, summarizeAfter: 40, contextWindow: 0, maxSteps: 8, stepTokens: 60000 });
  }
});
