'use strict';

/**
 * Many steps and nothing moving (turn/stall.js; 2026-10-17: a work chat spent 1 h 40 min on the last step of its plan
 * building a robot player of its own, every call succeeding). What counts as the work moving, a real turn told to take
 * stock and then made to report with no tools, and the supervisor reporting the job blocked instead of waking it again.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const stall = require('../modules/harness/turn/stall');

const call = (id, name, args) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const result = (id, content) => ({ role: 'tool', tool_call_id: id, content });
const busy = (n, from = 0) => Array.from({ length: n }, (_, i) => [call(`b${from + i}`, 'shell', { command: 'echo try' }), result(`b${from + i}`, 'exit 0 try')]).flat();

test('what counts as the work moving, and what does not', () => {
  const root = ['/w/game'];
  assert.equal(stall.since(busy(7)).steps, 7, 'commands that succeed are not progress by themselves');
  assert.equal(stall.since([...busy(5), call('p', 'work_plan', { action: 'progress', step: 2, state: 'done' }), result('p', 'Step 2 done.'), ...busy(2, 9)]).steps, 2, 'a plan step done is');
  assert.equal(stall.since([...busy(5), call('p', 'work_plan', { action: 'progress', step: 2, state: 'running' }), result('p', 'ok'), ...busy(2, 9)]).steps, 8, 'marking it running again is not');
  assert.equal(stall.since([...busy(4), call('w', 'write_file', { path: 'src/a.js' }), result('w', 'Wrote 10 bytes'), ...busy(1, 9)], root).steps, 1, 'a file written in the project is');
  assert.equal(stall.since([...busy(4), call('w', 'write_file', { path: '/tmp/bot/run.mjs' }), result('w', 'Wrote 10 bytes'), ...busy(1, 9)], root).steps, 6, 'one written beside it, for a tool of its own, is not');
  assert.equal(stall.since([...busy(4), call('g', 'shell', { command: 'git commit -qm fix' }), result('g', 'exit 0'), ...busy(3, 9)]).steps, 3, 'a commit is');
  assert.equal(stall.since([...busy(4), call('g', 'shell', { command: 'git commit -qm fix' }), result('g', 'exit 1 nothing to commit'), ...busy(3, 9)]).steps, 8, 'a commit that did not happen is not');
  assert.equal(stall.since([...busy(4), call('d', 'agent_dispatch', { agent: 'tester', task: 'x' }), result('d', 'Mission msn_1 started'), ...busy(2, 9)]).steps, 2, 'handing work on is');
  assert.equal(stall.since([...busy(4), call('d', 'agent_dispatch', { agent: 'tester', task: 'x' }), result('d', 'Error: no such agent'), ...busy(2, 9)]).steps, 7, 'a refused hand-off is not');
  assert.equal(stall.since([...busy(4), { role: 'user', content: 'try the other way', from: { name: 'Delegated by Orchestrator' } }, ...busy(2, 9)]).steps, 2, 'a leader\'s or a person\'s word starts the count again');
  assert.equal(stall.since([...busy(4), { role: 'user', content: '[panel] Carry on', from: { name: 'Panel' } }, ...busy(2, 9)]).steps, 6, 'the panel\'s automatic wake does not');
  const noted = stall.since([...busy(4), { role: 'user', from: { name: 'DOCA', formFactor: 'hub' }, stall: true, content: '[DOCA] …' }, ...busy(1, 9)]);
  assert.deepEqual(noted, { steps: 5, noted: true, from: 0 }, 'DOCA\'s own note does not, and is remembered');
  assert.equal(stall.limits({ stallSteps: 0 }), null, '0 switches it off');
  assert.deepEqual(stall.limits({ stallSteps: 40 }), { note: 40, report: 50 });
});

test('the same files read over and over since the work last moved: one note from DOCA, early, naming them', () => {
  const rereads = require('../modules/harness/turn/rereads');
  const read = (id, p) => [call(id, 'read_file', { path: p }), result(id, 'text')];
  const shown = (id, c) => [call(id, 'shell', { command: c }), result(id, 'exit 0 text')];
  const rows = [...read('r1', 'src/scenes/Menu.js'), ...shown('s1', "cd /w && cat src/scenes/Menu.js && sed -n '1,40p' src/hook.js"),
    ...read('r2', './src/scenes/Menu.js'), ...shown('s2', 'head -50 /tmp/review.txt; tail -n 20 /tmp/review.txt'), ...read('r3', 'src/hook.js')];
  assert.equal(rereads.note(rows, { name: 'DOCA' }), null, 'three repeats: not yet');
  assert.equal(rereads.note([...rows, ...read('r4', 'src/scenes/Menu.js')], { name: 'DOCA' }), null, 'still five');
  const more = [...rows, ...read('r4', 'src/scenes/Menu.js'), ...read('r6', '/tmp/review.txt')];
  const n = rereads.note(more, { name: 'DOCA' });
  assert.match(n.content, /read these again since the work last moved: src\/scenes\/Menu\.js \(4×\), \/tmp\/review\.txt \(3×\), src\/hook\.js \(2×\)/);
  assert.equal(rereads.note([...more, n, ...read('r5', 'src/hook.js')], { name: 'DOCA' }), null, 'once per stretch');
  assert.equal(rereads.reads([...shown('g', "grep -n x src/a.js")]).length, 0, 'a search is not a read');
});

let server;
const asked = [];
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      asked.push({ tools: (body.tools || []).length, all: JSON.stringify(body.messages || []) });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const usage = { prompt_tokens: 100, completion_tokens: 5 };
      const frame = body.tools?.length
        ? { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${asked.length}`, type: 'function', function: { name: 'memory_list', arguments: '{}' } }] } }] }
        : { choices: [{ delta: { content: 'Report: I built tools around it and the plan step is still open.' } }] };
      res.write(`data: ${JSON.stringify(frame)}\n\n`); res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`); res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(require('../modules/paths').CONFIG_PATH, JSON.stringify({ models: { providers: { sstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'sstub', model: 'm', fallbackChain: [], summarizeAfter: 0, maxSteps: 30, stallSteps: 4 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

test('a real turn with an open plan: told to take stock, then made to report with no tools, and the turn says why it ended', async () => {
  const memory = require('../modules/harness/memory'), org = require('../modules/harness/organization'), agent = require('../modules/harness/agent');
  const s = org.create({ title: 'Prove the game' });
  memory.updateSession(s.id, { plan: { title: 'Game', steps: ['build', 'play it through'], progress: { 1: 'done', 2: 'running' }, state: 'approved' } });
  asked.length = 0;
  const r = await agent.turn({ message: 'Carry on', sessionId: s.id, emit: () => {} });
  assert.equal(r.stalled, true, JSON.stringify(r).slice(0, 300));
  assert.equal(asked.length, 10, 'four steps, the note, five more, then the report step');
  assert.ok(asked.slice(0, 9).every(a => a.tools > 0), 'tools until the report step');
  assert.equal(asked[9].tools, 0, 'none on the report step');
  assert.doesNotMatch(asked[3].all, /steps since anything moved/, 'not before the limit');
  assert.match(asked[4].all, /steps since anything moved/, 'the note is read before the fifth step');
  assert.match(asked[9].all, /No tools now/);
  assert.match(r.text, /stopped after \d+ steps without the work moving \(harness\.config\.doca\.stallSteps\)/);
  const notes = memory.messages(s.id).filter(m => m.stall);
  assert.equal(notes.length, 2, 'one note, one report row — the note is not repeated each step');
});

test('a conversation with no open plan is not counted', async () => {
  const memory = require('../modules/harness/memory'), org = require('../modules/harness/organization'), agent = require('../modules/harness/agent');
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'sstub', model: 'm', fallbackChain: [], summarizeAfter: 0, maxSteps: 7, stallSteps: 4 });
  const s = org.create({ title: 'No plan' });
  asked.length = 0;
  const r = await agent.turn({ message: 'Carry on', sessionId: s.id, emit: () => {} });
  assert.notEqual(r.stalled, true);
  assert.ok(!memory.messages(s.id).some(m => m.stall), 'no note without a plan to judge by');
});

test('the supervisor reports a stalled job blocked to its leader rather than waking it again', async () => {
  const memory = require('../modules/harness/memory'), org = require('../modules/harness/organization'), supervisor = require('../modules/harness/supervisor');
  const woken = [];
  supervisor._setTurn(async (sessionId, message) => { woken.push({ sessionId, message }); return { text: 'ok' }; });
  supervisor._setEnabled(true);
  try {
    const s = org.create({ title: 'Loop' });
    memory.updateSession(s.id, { job: { state: 'working', since: new Date().toISOString(), autoTurns: 0, idleTurns: 0 } });
    memory.append(s.id, { role: 'assistant', content: 'Report: the bot keeps dying on level 3.' });
    supervisor.decide(s.id, { steps: 10, stalled: { steps: 50 } });
    await new Promise(r => setImmediate(() => setImmediate(r)));
    assert.equal(memory.getSession(s.id).job.state, 'blocked');
    assert.ok(!woken.some(w => w.sessionId === s.id), 'not woken again');
    const toLeader = woken.find(w => w.sessionId === memory.mainSession().id);
    assert.match(toLeader?.message || '', /50 steps without the work moving.*Its report: Report: the bot keeps dying/s);
  } finally { supervisor._setEnabled(false); }
});
