'use strict';

// Evaluation sets (modules/evals, TODO H10.1): checks read without a model, sets validated, promptfoo and OpenAI
// Evals formats both ways, a set run as real turns against a scripted model — and a run from the panel, which is
// the CLI in a child process on a throwaway copy of the settings.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');

let server;
const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };
// The stub answers from the question: arithmetic gets 391, a remember gets a memory_write call, a judge gets PASS.
function reply(body) {
  const sys = body.messages.find(m => m.role === 'system')?.content || '';
  const last = JSON.stringify(body.messages.filter(m => m.role === 'user').map(m => m.content));   // the request and the panel's readings
  const afterTool = body.messages.some(m => m.role === 'tool');
  if (/grade an AI assistant/.test(sys)) return { text: /391/.test(last) ? 'PASS it gives the number.' : 'FAIL no number.' };
  if (afterTool) return { text: 'Noted.' };
  if (/Remember/.test(last)) return { tool: 'memory_write', args: { key: 'printer', value: '10.0.0.42' } };
  if (/17 × 23/.test(last)) return { text: '391' };
  return { text: 'I am not sure.' };
}

before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const r = reply(JSON.parse(raw || '{}'));
      const usage = { prompt_tokens: 100, completion_tokens: 5 };
      if (r.tool) return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: r.tool, arguments: JSON.stringify(r.args) } }] } }] }, { choices: [], usage }])(res);
      return sse([{ choices: [{ delta: { content: r.text } }] }, { choices: [], usage }])(res);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { estub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'estub', model: 'm', fallbackChain: [], summarizeAfter: 0 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

test('each check reads the outcome it names', async () => {
  const { one } = require('../modules/evals/check');
  const o = { text: 'The answer is 391.', tools: ['memory_write', 'mcp__blender__render'], steps: 3, tokens: 900 };
  for (const [c, pass] of [[{ contains: 'ANSWER' }, true], [{ notContains: '391' }, false], [{ matches: 'is \\d+' }, true], [{ matches: '(' }, false],
    [{ tool: 'memory_write' }, true], [{ tool: 'mcp__blender__' }, true], [{ noTool: 'shell' }, true], [{ maxSteps: 2 }, false], [{ maxTokens: 1000 }, true], [{ nope: 1 }, false]])
    assert.equal((await one(c, 'q', o)).pass, pass, JSON.stringify(c));
  const failed = await require('../modules/evals/check').evaluate({ prompt: 'q', checks: [{ contains: 'x' }] }, { state: 'failed', error: 'no model' });
  assert.match(failed[0].why, /the turn failed: no model/);
});

test('the shipped set is valid; a set of your own is saved, wins over nothing shipped, and is deleted', () => {
  const store = require('../modules/evals/store');
  assert.equal(store.validate(store.get('basics')).cases.length, 6);
  assert.throws(() => store.validate({ id: 'x', cases: [{ id: 'a', prompt: 'p', checks: [] }] }), /no checks/);
  assert.throws(() => store.validate({ id: '../x', cases: [] }), /needs an id/);
  store.save({ id: 'mine', cases: [{ id: 'a', prompt: 'hi', checks: [{ contains: 'hi' }] }] });
  assert.equal(store.get('mine').origin, 'yours');
  assert.throws(() => store.remove('basics'), /shipped set cannot be deleted/);
  store.remove('mine');
  assert.equal(store.get('mine'), null);
});

test('[IO] promptfoo YAML out, OpenAI Evals JSONL in', () => {
  const io = require('../modules/evals/io');
  const y = io.promptfoo(require('../modules/evals/store').get('basics'));
  assert.match(y, /tests:\n {2}- description: "no-tool-arithmetic"\n {4}vars:\n {6}prompt: "What is 17 × 23\? Answer with the number only."/);
  assert.match(y, /- type: icontains\n {8}value: "391"/);
  assert.match(y, /- type: llm-rubric/);
  assert.match(y, /# DOCA-only check, not exported: \{"noTool":"shell"\}/);
  const jsonl = [JSON.stringify({ input: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Capital of France?' }], ideal: 'Paris' }),
    JSON.stringify({ input: [{ role: 'user', content: 'Two words' }], ideal: ['a b', 'c.d'] }), 'not json', JSON.stringify({ input: 'no ideal' })].join('\n');
  const { set, skipped } = io.fromOpenAiEvals(jsonl, { id: 'oai' });
  assert.equal(skipped, 2);
  assert.equal(set.cases[0].prompt, 'Be brief.\n\nCapital of France?');
  assert.deepEqual(set.cases[0].checks, [{ contains: 'Paris' }]);
  assert.deepEqual(set.cases[1].checks, [{ matches: 'a b|c\\.d' }]);
});

test('a set runs as real turns; the result names tools, steps and what regressed', async () => {
  const set = { id: 't', title: 'T', cases: [
    { id: 'sum', prompt: 'What is 17 × 23?', checks: [{ contains: '391' }, { judge: 'gives the number' }] },
    { id: 'mem', prompt: 'Remember my printer is at 10.0.0.42', checks: [{ tool: 'memory_write' }, { maxSteps: 3 }] },
    { id: 'ask', mode: 'ask', prompt: 'Something vague', checks: [{ contains: 'certainly' }] }] };
  const seen = [];
  const r = await require('../modules/evals/run').runSet(set, { onCase: (c, i, n) => seen.push(`${i}/${n}`), previous: { cases: [{ id: 'ask', pass: true }, { id: 'mem', pass: false }] } });
  assert.deepEqual(seen, ['1/3', '2/3', '3/3']);
  assert.equal(r.passed, 2, JSON.stringify(r.cases.map(c => [c.id, c.state, c.error, c.text])));
  assert.equal(r.model, 'estub / m');
  const [sum, mem] = r.cases;
  assert.equal(sum.pass, true, JSON.stringify(sum.checks));
  assert.match(sum.checks[1].why, /^judge: it gives the number/);
  assert.deepEqual(mem.tools, ['memory_write']);
  assert.equal(mem.steps, 2);
  assert.ok(mem.tokens > 0);
  assert.deepEqual(r.regressed, ['ask']);
  assert.deepEqual(r.fixed, ['mem']);
});

test('from the panel: a host runs a set in a child process on a throwaway copy; the result lands here', async () => {
  const member = await H.signIn('member', 'eval-member@test.local');
  assert.equal((await H.api(null, 'GET', '/api/evals', undefined, { Cookie: member.cookie })).status, 403);
  const imp = await H.api(null, 'POST', '/api/evals/import', { text: JSON.stringify({ id: 'tiny', cases: [{ id: 'sum', prompt: 'What is 17 × 23?', checks: [{ contains: '391' }] }] }) });
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  const started = await H.api(null, 'POST', '/api/evals/tiny/run');
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal((await H.api(null, 'POST', '/api/evals/tiny/run')).status, 409, 'one run at a time');
  let d;
  for (let i = 0; i < 300; i++) { d = (await H.api(null, 'GET', '/api/evals/tiny')).body; if (d.running?.done) break; await new Promise(r => setTimeout(r, 100)); }
  assert.equal(d.running.done, true);
  assert.equal(d.running.error, null, JSON.stringify(d.running));
  assert.equal(d.results[0].passed, 1);
  assert.equal(d.results[0].cases[0].text, '391');
  const mem = require('../modules/harness/memory');
  assert.ok(!mem.listSessions().sessions.some(s => /^Eval · tiny/.test(s.title)), 'its conversations stayed in the sandbox');
  const y = await fetch(`${H.base}/api/evals/tiny/export?format=promptfoo`, { headers: { Cookie: H.owner.cookie } });
  assert.match(y.headers.get('content-disposition'), /tiny\.promptfooconfig\.yaml/);
  assert.match(await y.text(), /icontains/);
});

test('comparing: --flag runs the set with the experiment off and on, and prints both (TODO B7)', async () => {
  // Not spawnSync: the stub model answering the child lives in this process, which must keep running.
  const child = require('node:child_process').spawn(process.execPath, [require('node:path').join(__dirname, '..', 'bin', 'doca-eval.js'), 'tiny', '--flag', 'toolTiers', '--json'], { env: process.env });
  let out = '', err = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
  const code = await new Promise(r => child.on('close', r));
  const lines = out.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const cmp = lines.find(l => l.compare)?.compare;
  assert.ok(cmp, out + err);
  assert.deepEqual(cmp.map(x => [x.label, x.passed, x.total]), [['configured model · toolTiers off', 1, 1], ['configured model · toolTiers on', 1, 1]]);
  assert.equal(code, 0);
});

test('anyTool passes when one of several right tools was called', async () => {
  const { one } = require('../modules/evals/check');
  assert.equal((await one({ anyTool: ['skill', 'work_chats'] }, 'q', { tools: ['work_chats'] })).pass, true);
  assert.equal((await one({ anyTool: ['skill'] }, 'q', { tools: ['shell'] })).pass, false);
});
