'use strict';

// Recipes (modules/recipes, TODO H3): kept from a turn that worked, run again without a model through the same
// gate as the agent's own calls, stopped at the first failed check, and exported as a script per OS.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');

let model, script = [];
const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };
const call = (name, args) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${Math.random().toString(36).slice(2, 7)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });

before(async () => {
  model = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[{"id":"stub-model"}]}'); }
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (body.stream === false) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'); }
      const next = script.shift() || { text: '(script exhausted)' };
      return sse(next.tool ? [call(next.tool, next.args)] : [{ choices: [{ delta: { content: next.text } }] }])(res);
    });
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'k', models: ['stub-model'] } } } }));
  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
});
after(async () => { await H.stop(); await new Promise(r => model.close(r)); });

const ECHO = process.platform === 'win32' ? 'Write-Output' : 'echo';

test('a turn that worked becomes a recipe: its calls in order, the failed one left out, a value lifted into a parameter', async () => {
  const s = require('../modules/harness/memory').createSession('make recipe', { activate: false });
  script = [{ tool: 'shell', args: { command: `${ECHO} hello-world` } }, { tool: 'read_file', args: { path: '/definitely/not/here' } },
    { tool: 'shell', args: { command: `${ECHO} again-world` } }, { text: 'Done.' }];
  await require('../modules/harness/agent').turn({ message: 'greet', sessionId: s.id });
  const r = await H.api(null, 'POST', '/api/recipes/from-session', { sessionId: s.id, title: 'Greet someone', description: 'Say hello twice.',
    params: [{ name: 'who', value: 'world', description: 'whom to greet' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.id, 'greet-someone');
  assert.deepEqual(r.body.steps.map(x => x.tool), ['shell', 'shell'], 'the failed read_file stays behind');
  assert.equal(r.body.steps[0].args.command, `${ECHO} hello-{who}`);
  assert.deepEqual(r.body.params, [{ name: 'who', description: 'whom to greet', default: 'world' }]);
});

test('a run needs no model, goes step by step through the tool layer, and leaves a transcript', async () => {
  script = [];   // nothing for the model to say: a run must not ask it
  const r = await H.api(null, 'POST', '/api/recipes/greet-someone/run', { values: { who: 'Al' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.steps.length, 2);
  assert.match(r.body.steps[0].result, /hello-Al|hello-'Al'/);
  const rows = require('../modules/harness/memory').messages(r.body.sessionId);
  assert.equal(rows.filter(x => x.role === 'tool').length, 2);
  assert.match(rows.at(-1).content, /every check passed/);
});

test('a failed check stops the run at that step and says why', async () => {
  const store = require('../modules/recipes/store');
  store.save({ title: 'Stops early', steps: [
    { tool: 'shell', args: { command: `${ECHO} one` } },
    { tool: 'shell', args: { command: `${ECHO} two` }, check: { contains: 'three' } },
    { tool: 'shell', args: { command: `${ECHO} never` } }] });
  const r = await H.api(null, 'POST', '/api/recipes/stops-early/run', {});
  assert.equal(r.body.ok, false);
  assert.equal(r.body.failedAt, 2);
  assert.match(r.body.steps[1].why, /does not contain "three"/);
  assert.equal(r.body.steps.length, 2, 'step three never ran');
  assert.equal((await H.api(null, 'POST', '/api/recipes/greet-someone/run', { values: { who: '' } })).status, 200, 'an empty value falls back to the default');
});

test('in manual mode a step is asked like the agent\'s own call; a denial stops the run', async () => {
  await H.api(null, 'POST', '/api/harness/approval', { mode: 'manual' });
  try {
    const running = H.api(null, 'POST', '/api/recipes/greet-someone/run', { values: { who: 'gate' } });
    const approval = require('../modules/harness/approval');
    let asked = [];
    for (let i = 0; i < 100 && !asked.length; i++) { await H.sleep(50); asked = approval.pending(); }
    assert.equal(asked.length, 1, 'the first step waits for a person');
    assert.equal(asked[0].tool, 'shell');
    assert.equal((await H.api(null, 'POST', `/api/harness/approvals/${asked[0].id}`, { decision: 'deny' })).status, 200);
    const r = await running;
    assert.equal(r.body.ok, false);
    assert.equal(r.body.failedAt, 1);
    assert.match(r.body.steps[0].why, /^(Refused|Denied|Not run)|denied/i);
  } finally { await H.api(null, 'POST', '/api/harness/approval', { mode: 'auto' }); }
});

test('a value is quoted for the shell once, quotes the author wrote included', () => {
  const { fill } = require('../modules/recipes/run');
  const posix = !require('../modules/shell').WIN;
  const v = { p: "it's a b" };
  const a = fill('cat {p}', v, { shellQuote: true });
  const b = fill('cat "{p}"', v, { shellQuote: true });
  assert.equal(a, b);
  assert.equal(a, posix ? "cat 'it'\\''s a b'" : "cat 'it''s a b'");
  assert.equal(fill('note {p}', v), "note it's a b", 'outside a shell step the value is as given');
});

test('a shell-only recipe exports as bash and PowerShell; one with other tools only as JSON', async () => {
  const sh = await H.api(null, 'GET', '/api/recipes/greet-someone/export?format=bash');
  assert.equal(sh.status, 200);
  assert.match(sh.body, /^#!\/usr\/bin\/env bash/);
  assert.match(sh.body, /who="\$\{1:-world\}"/);
  assert.match(sh.body, /hello-"\$who"/);
  const ps = await H.api(null, 'GET', '/api/recipes/greet-someone/export?format=powershell');
  assert.match(ps.body, /param\(\[string\]\$who = 'world'\)/);
  require('../modules/recipes/store').save({ title: 'Mixed', steps: [{ tool: 'read_file', args: { path: 'x' } }] });
  assert.equal((await H.api(null, 'GET', '/api/recipes/mixed/export?format=bash')).status, 409);
  const json = await H.api(null, 'GET', '/api/recipes/mixed/export?format=json');
  assert.equal(json.body.doca, 'recipe');
});

test('the agent saves its last turn and runs a recipe; a specialist never holds the tool', async () => {
  const s = require('../modules/harness/memory').createSession('agent recipes', { activate: false });
  script = [{ tool: 'recipe', args: { action: 'run', id: 'greet-someone', values: { who: 'agent' } } }, { text: 'Ran it.' }];
  await require('../modules/harness/agent').turn({ message: 'run greet', sessionId: s.id });
  const result = require('../modules/harness/memory').messages(s.id).find(x => x.role === 'tool' && x.name === 'recipe');
  assert.match(result.content, /Recipe done: 2 steps/);
  assert.ok(require('../modules/agents/registry').NEVER.includes('recipe'));
  const viewer = await H.signIn('viewer', 'recipe-viewer@test.local');
  assert.equal((await H.api(null, 'POST', '/api/recipes/greet-someone/run', {}, { Cookie: viewer.cookie })).status, 403);
  const member = await H.signIn('member', 'recipe-member@test.local');
  assert.equal((await H.api(null, 'DELETE', '/api/recipes/mixed', undefined, { Cookie: member.cookie })).status, 403);
  assert.equal((await H.api(null, 'DELETE', '/api/recipes/mixed')).status, 200);
});
