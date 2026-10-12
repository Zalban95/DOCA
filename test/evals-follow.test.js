'use strict';

// --follow (evals/follow.js; the design "Always free" §6.3): a case waits for the work chats it handed work to and
// counts what they did, records when the first word and the result came, and names the lane the front took.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');
const experiments = require('../modules/experiments');

let server;
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    // system_status asks local model servers who they work for (GET /models, /slots): not a chat request.
    if (req.method !== 'POST') { res.writeHead(404); res.end('{}'); return; }
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const users = JSON.stringify(body.messages.filter(m => m.role === 'user').map(m => m.content));
      const afterTool = body.messages.some(m => m.role === 'tool');
      const worker = /handed to you before any work was done/.test(users);
      let message;
      // The worker marks its seeded step done, then reports (a done report with the plan open is not accepted: projects/finish.js).
      const toolsRun = body.messages.filter(m => m.role === 'tool').length;
      const call = (name, args) => ({ content: '', tool_calls: [{ id: `w${toolsRun}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
      if (worker && toolsRun === 0) message = call('work_plan', { action: 'progress', step: 1, state: 'done' });
      else if (worker && toolsRun === 1) message = call('work_chats', { action: 'report', outcome: 'done', message: 'Built it.' });
      else if (!worker && !afterTool && /GPU/.test(users)) message = { content: '', tool_calls: [{ id: 'g1', type: 'function', function: { name: 'system_status', arguments: '{}' } }] };
      else message = { content: worker ? 'Reported.' : 'Hello!' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 50, completion_tokens: 5 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { vstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'vstub', model: 'm', fallbackChain: [], summarizeAfter: 0, orchestratorWorkSteps: 0 });
  experiments.setDeveloper(true); experiments.set('alwaysFree', true);
});
after(async () => { experiments.set('alwaysFree', false); server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

const { runCase } = require('../modules/evals/run');
const kase = (id, prompt, lane, checks) => ({ id, prompt, lane, checks: [{ lane }, ...checks] });

test('a job is followed to its end: the work chat\'s tools count, the first word and the result are timed', async () => {
  const c = await runCase(kase('job', 'Build a small landing page app from scratch, with a contact form and every page', 'job',
    [{ minChildren: 1 }, { maxSteps: 1 }, { tool: 'work_chats' }, { maxFirstMs: 5000 }]), 'front', { as: 'orchestrator', follow: 20 });
  assert.equal(c.pass, true, JSON.stringify(c.checks));
  assert.equal(c.lane, 'job');
  assert.equal(c.expectedLane, 'job');
  assert.equal(c.followed, 'done');
  assert.deepEqual(c.childTools, ['work_plan', 'work_chats']);
  assert.ok(c.childSteps >= 1);
  assert.ok(c.resultMs != null && c.resultMs >= 0, 'when its report came');
  assert.equal(c.steps, 0, 'the front asked no model');
});

test('talk and look stay in front, with no work chat', async () => {
  const talk = await runCase(kase('hi', 'Hi! Just say hello back.', 'talk', [{ maxChildren: 0 }, { maxSteps: 1 }]), 'front', { as: 'orchestrator', follow: true });
  assert.equal(talk.pass, true, JSON.stringify(talk.checks));
  const look = await runCase(kase('gpu', 'Is the GPU busy right now?', 'look', [{ maxChildren: 0 }, { tool: 'system_status' }]), 'front', { as: 'orchestrator', follow: true });
  assert.equal(look.pass, true, JSON.stringify(look.checks));
  const wrong = await require('../modules/evals/check').one({ lane: 'job' }, 'q', look);
  assert.match(wrong.why, /lane look, expected job/);
});

test('the shipped front set is valid, every case labelled with a lane', () => {
  const store = require('../modules/evals/store');
  const set = store.validate(store.get('front'));
  assert.ok(set.cases.length >= 25);
  const lanes = new Set(set.cases.map(c => c.lane));
  for (const l of ['talk', 'look', 'do-now', 'job', 'amend']) assert.ok(lanes.has(l), `a ${l} case`);
  assert.ok(set.cases.every(c => c.checks[0].lane === c.lane));
  assert.ok(set.cases.filter(c => c.lane === 'amend').every(c => c.setup?.length), 'an amend says a job first');
});
