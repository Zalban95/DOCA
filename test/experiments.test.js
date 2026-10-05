'use strict';

// Experiments behind flags (modules/experiments.js, hive.md §8) and the first one: a failed recipe repaired by the
// agent as a proposal a person accepts (docs/experiments/recipe-repair.md, TODO H3.4).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');

let model, script = [], calls = 0;
before(async () => {
  model = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[{"id":"stub-model"}]}'); }
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (body.stream === false) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'); }
      calls++;
      const next = script.shift() || { text: '(script exhausted)' };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = next.tool ? { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${calls}`, type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args) } }] } }] }
        : { choices: [{ delta: { content: next.text } }] };
      res.end(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'k', models: ['stub-model'] } } } }));
  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
});
after(async () => { await H.stop(); await new Promise(r => model.close(r)); });

const ECHO = process.platform === 'win32' ? 'Write-Output' : 'echo';
const waitFor = async (fn, ms = 8000) => { for (let i = 0; i < ms / 50; i++) { const v = fn(); if (v) return v; await H.sleep(50); } return null; };

test('experiments are listed with their write-up, off by default, and the agent cannot propose switching one on', async () => {
  const r = await H.api(null, 'GET', '/api/experiments');
  const x = r.body.experiments.find(e => e.id === 'recipeRepair');
  assert.equal(x.on, false);
  assert.match(x.docText, /## Hypothesis/);
  assert.match(x.docText, /## Rollback/);
  assert.notEqual(require('../modules/harness/settings').refuse('experiments.recipeRepair', true), null, 'not proposable');
  const member = await H.signIn('member', 'exp-member@test.local');
  assert.equal((await H.api(null, 'POST', '/api/experiments/recipeRepair', { on: true }, { Cookie: member.cookie })).status, 403);
});

test('off: a failed recipe just stops — no repair turn', async () => {
  require('../modules/recipes/store').save({ title: 'Broken off', steps: [{ tool: 'shell', args: { command: `${ECHO} wrong` }, check: { contains: 'right' } }] });
  calls = 0;
  const r = await H.api(null, 'POST', '/api/recipes/broken-off/run', {});
  assert.equal(r.body.ok, false);
  await H.sleep(300);
  assert.equal(calls, 0, 'the model is not asked');
});

test('without developer mode no experiment can be switched on or takes effect; an owner turns it on', async () => {
  const r = await H.api(null, 'GET', '/api/experiments');
  assert.equal(r.body.developer, false, 'a fresh install is not a developer\'s');
  assert.equal((await H.api(null, 'POST', '/api/experiments/recipeRepair', { on: true })).status, 409);
  const member = await H.signIn('member', 'dev-member@test.local');
  assert.equal((await H.api(null, 'POST', '/api/experiments/developer', { on: true }, { Cookie: member.cookie })).status, 403, 'an owner\'s switch');
  assert.equal((await H.api(null, 'POST', '/api/experiments/developer', { on: true })).body.developer, true);
  assert.notEqual(require('../modules/harness/settings').refuse('developer.mode', true), null, 'not proposable');
  // A flag left on stops taking effect the moment developer mode goes off.
  require('../modules/experiments').set('bargeIn', true);
  require('../modules/experiments').setDeveloper(false);
  assert.equal(require('../modules/experiments').on('bargeIn'), false);
  require('../modules/experiments').setDeveloper(true);
  assert.equal(require('../modules/experiments').on('bargeIn'), true);
  require('../modules/experiments').set('bargeIn', false);
});

test('an install that had an experiment on keeps it: the migration turns developer mode on', () => {
  const { run } = require('../modules/migrations');
  assert.equal(run({ experiments: { bargeIn: true } }).prefs.developer.mode, true);
  assert.equal(run({ experiments: { bargeIn: false } }).prefs.developer, undefined);
  assert.equal(run({ experiments: { bargeIn: true }, developer: { mode: false } }).prefs.developer.mode, false, 'an owner who chose off stays off');
});

test('on: the agent proposes a repaired revision; a person accepts it; the next run passes', async () => {
  assert.equal((await H.api(null, 'POST', '/api/experiments/recipeRepair', { on: true })).body.on, true);
  const store = require('../modules/recipes/store');
  store.save({ title: 'Broken on', steps: [{ tool: 'shell', args: { command: `${ECHO} wrong` }, check: { contains: 'right' } }] });
  script = [
    { tool: 'recipe', args: { action: 'propose', id: 'broken-on', steps: [{ tool: 'shell', args: { command: `${ECHO} right` }, check: { contains: 'right' } }], why: 'The command printed the wrong word.' } },
    { text: 'Proposed a fix.' },
  ];
  const first = await H.api(null, 'POST', '/api/recipes/broken-on/run', {});
  assert.equal(first.body.ok, false);
  const p = await waitFor(() => store.proposed('broken-on'));
  assert.ok(p, 'a proposal arrived');
  assert.equal(store.get('broken-on').revision, 1, 'nothing changed until a person accepts');
  const listed = (await H.api(null, 'GET', '/api/recipes')).body.recipes.find(r => r.id === 'broken-on');
  assert.equal(listed.proposed.why, 'The command printed the wrong word.');
  const before = calls;
  await H.api(null, 'POST', '/api/recipes/broken-on/run', {});
  await H.sleep(300);
  assert.equal(calls, before, 'a proposal pending: no second repair');
  assert.equal((await H.api(null, 'POST', '/api/recipes/broken-on/accept')).body.revision, 2);
  const again = await H.api(null, 'POST', '/api/recipes/broken-on/run', {});
  assert.equal(again.body.ok, true);
  await H.api(null, 'POST', '/api/experiments/recipeRepair', { on: false });
});
