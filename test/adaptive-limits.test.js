'use strict';

/**
 * Limits that follow the work (experiment adaptiveLimits, TODO H10.6): the triage's rules, the extension rule, a real
 * turn with the flag off (today's behaviour exactly) and on, and the measurement script against a scripted model.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');   // first: it points the settings at a temporary folder (see its top)
const triage = require('../modules/harness/turn/triage');
const extend = require('../modules/harness/turn/extend');

let server;
const bodies = [];
const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };
// The stub keeps working: a new memory_write per step, until it has made `WANT` calls, then answers.
const WANT = 3;
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      bodies.push(body);
      const usage = { prompt_tokens: 100, completion_tokens: 5 };
      const sys = body.messages?.find(m => m.role === 'system')?.content || '';
      if (/You sort requests/.test(sys)) return sse([{ choices: [{ delta: { content: 'large normal' } }] }, { choices: [], usage }])(res);
      const done = (body.messages || []).filter(m => m.role === 'tool').length;
      const lastUser = JSON.stringify((body.messages || []).filter(m => m.role === 'user').map(m => m.content));
      if (done >= WANT || /17 × 23/.test(lastUser)) return sse([{ choices: [{ delta: { content: /17 × 23/.test(lastUser) ? '391' : 'All written.' } }] }, { choices: [], usage }])(res);
      return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${done}`, type: 'function', function: { name: 'memory_write', arguments: JSON.stringify({ key: `note-${Date.now()}-${done}`, value: `v${done}` }) } }] } }] }, { choices: [], usage }])(res);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(require('../modules/paths').CONFIG_PATH, JSON.stringify({ models: { providers: { astub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'astub', model: 'm', fallbackChain: [], summarizeAfter: 0, maxSteps: 2 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

const experiments = () => require('../modules/experiments');
const flag = v => { experiments().setDeveloper(true); experiments().set('adaptiveLimits', v); };

test('the rules: a short question is small, a build of a whole thing large, words and clients make it quick', () => {
  const q = triage.rate({ message: 'What is 17 × 23?' });
  assert.deepEqual([q.difficulty, q.urgency, q.sure], ['small', 'normal', true]);
  const b = triage.rate({ message: 'Build a website from scratch with a login page, a dashboard of my machines and a settings page for each of them.' });
  assert.equal(b.difficulty, 'large', b.reasons.join('; '));
  assert.equal(triage.rate({ message: 'Just tell me quickly whether the disk is full' }).urgency, 'quick');
  assert.equal(triage.rate({ message: 'Tell me whether the disk is full', client: { mode: 'call' } }).urgency, 'quick');
  assert.equal(triage.rate({ message: 'Tell me whether the disk is full', client: { formFactor: 'watch' } }).urgency, 'quick');
  const steps = triage.rate({ message: 'Please do this:\n1. pull the repo\n2. run the tests\n3. send me the result' });
  assert.equal(steps.difficulty, 'large', steps.reasons.join('; '));
  const mid = triage.rate({ message: 'Find every file in the workspace that mentions the word invoice.' });
  assert.deepEqual([mid.difficulty, mid.sure], ['medium', false], 'unsure: the one place a model is asked');
  const plan = { job: { plan: { steps: ['a', 'b', 'c'], progress: { 1: 'done' } } } };
  assert.equal(triage.openPlanSteps(plan), 2);
  assert.match(triage.rate({ message: 'Carry on with the work please, there is more to do here', session: plan }).reasons.join(), /a plan with 2 open steps/);
  assert.deepEqual(triage.parseModel('Large, normal.'), { difficulty: 'large', urgency: 'normal' });
  assert.equal(triage.parseModel('no idea'), null);
});

test('the budget is never under today\'s maxSteps, never over the ceiling; the person\'s own effort wins', () => {
  assert.deepEqual(['small', 'medium', 'large'].map(d => triage.stepsFor(d, 8, 64)), [8, 16, 32]);
  assert.equal(triage.stepsFor('large', 8, 20), 20);
  assert.equal(triage.stepsFor('small', 30, 30), 30);
  assert.equal(triage.ceilingFor(100), 100, 'a ceiling under the base would lower it: the base stands');
  assert.equal(triage.ceilingFor(8), 64, 'limits.maxStepsCeiling, 64 by default');
  assert.deepEqual(['small', 'medium', 'large'].map(d => triage.effortFor({ difficulty: d, urgency: 'normal' })), ['low', 'medium', 'high']);
  assert.equal(triage.effortFor({ difficulty: 'large', urgency: 'quick' }), 'low');
  const v = { difficulty: 'large', urgency: 'normal', effort: 'high' };
  assert.deepEqual(triage.effort({ level: 'off', from: 'this conversation' }, v), { level: 'off', from: 'this conversation' });
  assert.equal(triage.effort({ level: null, from: null }, v).level, 'high');
  const none = { level: 'low', from: 'x' };
  assert.equal(triage.effort(none, null), none, 'no verdict: exactly what levelFor said');
});

test('the extension rule: two new successful steps carry on; a failure, a repeat or a loop stops as before', () => {
  const step = (args, result) => [{ role: 'assistant', tool_calls: [{ function: { name: 'read_file', arguments: args } }] }, { role: 'tool', content: result }];
  const v = { base: 4, ceiling: 10 };
  const good = [{ role: 'user', content: 'go' }, ...step('{"a":1}', 'ok'), ...step('{"a":2}', 'ok')];
  assert.deepEqual(extend.extension({ v, step: 4, budget: 4, rows: good, from: 0 }), { to: 8, why: 'the last two steps\' calls all succeeded, each doing something new' });
  assert.equal(extend.extension({ v, step: 8, budget: 8, rows: good, from: 0 }).to, 10, 'up to the ceiling');
  assert.equal(extend.extension({ v, step: 10, budget: 10, rows: good, from: 0 }), null, 'never past it');
  assert.equal(extend.extension({ v: null, step: 4, budget: 4, rows: good, from: 0 }), null, 'experiment off: never');
  assert.equal(extend.extension({ v, step: 4, budget: 4, rows: [...good, ...step('{"a":3}', 'Error: ENOENT no such file')], from: 0 }), null);
  assert.equal(extend.extension({ v, step: 4, budget: 4, rows: [...good, ...step('{"a":2}', 'ok')], from: 0 }), null, 'the same calls again');
  assert.equal(extend.extension({ v, step: 4, budget: 4, rows: good, from: 0, loop: { tool: 'shell', times: 3, kind: 'timeout' } }), null);
  assert.equal(extend.extension({ v, step: 4, budget: 4, rows: good.slice(0, 3), from: 0 }), null, 'one step is not enough to tell');
  const closed = extend.advancing({ rows: [], planOpenAtStart: 3, session: { job: { plan: { steps: ['a', 'b', 'c'], progress: { 1: 'done' } } } } });
  assert.deepEqual(closed, { ok: true, why: '1 step of the plan closed this turn' });
  assert.match(extend.warning({ to: 8, why: 'x' }, 4, 10).text, /extended to 8 steps, up to limits.maxStepsCeiling \(10\)/);
});

test('flag off: no triage, no effort sent, the limits and the stop note as today', async () => {
  flag(false);
  assert.equal(await triage.verdict({ message: 'Build an app', p: { maxSteps: 8 } }), null);
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('adaptive off', { activate: false });
  const events = [];
  bodies.length = 0;
  const r = await require('../modules/harness/agent').turn({ message: 'Write three notes', sessionId: s.id, emit: e => events.push(e) });
  assert.equal(r.steps, 2);
  assert.match(r.text, /Stopped after 2 tool steps without a final answer — that is this panel's own limit \(harness\.config\.doca\.maxSteps\)/);
  assert.ok(!events.some(e => e.type === 'triage' || e.kind === 'extended'));
  assert.ok(bodies.every(b => b.reasoning_effort === undefined), 'nothing about effort is sent');
  assert.match(bodies[0].messages[0].content, /tool steps: 2 per turn \(harness\.config\.doca\.maxSteps\)/);
});

test('flag on: the verdict sets effort and steps, a turn still advancing is extended, and the trace says both', async () => {
  flag(true);
  const memory = require('../modules/harness/memory');
  try {
    const s = memory.createSession('adaptive on', { activate: false });
    const events = [];
    bodies.length = 0;
    const r = await require('../modules/harness/agent').turn({ message: 'Write three notes', sessionId: s.id, emit: e => events.push(e) });
    const t = events.find(e => e.type === 'triage');
    assert.equal(t.difficulty, 'small', JSON.stringify(t));
    assert.equal(t.steps, 2, 'small: today\'s maxSteps, never less');
    assert.equal(bodies[0].reasoning_effort, 'low');
    assert.match(bodies[0].messages[0].content, /tool steps: 2 this turn — the triage rated it small/);
    const x = events.find(e => e.kind === 'extended');
    assert.ok(x, events.map(e => e.type + (e.kind ? `:${e.kind}` : '')).join(' '));
    assert.equal(x.to, 4);
    assert.equal(r.steps, 4);
    assert.match(r.text, /All written/);
    const spans = require('../modules/harness/trace').spans(r.runId);
    assert.ok(spans.some(sp => sp.kind === 'triage' && sp.data.difficulty === 'small' && sp.data.steps === 2), JSON.stringify(spans.map(sp => sp.kind)));
    assert.ok(spans.some(sp => sp.kind === 'warning' && sp.name === 'extended' && sp.data.to === 4));

    // Unsure rules ask assistant mode's quick model, when one is set.
    const { loadPrefs, savePrefs } = require('../modules/utils');
    savePrefs({ ...loadPrefs(), assistant: { ...(loadPrefs().assistant || {}), provider: 'astub', model: 'quick' } });
    const v = await triage.verdict({ message: 'Find every file in the workspace that mentions the word invoice.', p: { maxSteps: 2 } });
    assert.deepEqual([v.difficulty, v.by, v.steps, v.effort], ['large', 'model (astub / quick)', 8, 'high']);
  } finally { flag(false); }
});

test('the measurement: a tagged set off and on, by difficulty, against the scripted model', async () => {
  require('../modules/evals/store').save({ id: 'adaptive-tiny', cases: [
    { id: 'sum', difficulty: 'small', prompt: 'What is 17 × 23?', checks: [{ contains: '391' }] },
    { id: 'notes', difficulty: 'large', prompt: 'Write three notes', checks: [{ tool: 'memory_write' }] }] });
  assert.equal(require('../modules/evals/store').get('adaptive-tiny').cases[0].difficulty, 'small');
  assert.throws(() => require('../modules/evals/store').validate({ id: 'x', cases: [{ id: 'a', prompt: 'p', difficulty: 'huge', checks: [{ contains: 'p' }] }] }), /difficulty is small, medium, large/);
  const out = await new Promise((resolve, reject) => {
    const child = require('node:child_process').spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'doca-experiment.js'), 'adaptive-limits', 'adaptive-tiny'],
      { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', d => { text += d; }); child.stderr.on('data', d => { text += d; });
    child.on('close', code => (code === 0 ? resolve(text) : reject(new Error(`exit ${code}: ${text}`))));
  });
  if (process.env.SHOW_OUT) console.log(out);
  assert.match(out, /\| \d{4}-\d{2}-\d{2} \| configured model \| adaptive-tiny \| off \| 2\/2 \|/);
  assert.match(out, /\| adaptive-tiny \| on \| 2\/2 \| \d+ \| \d+ \| [\d.]+ s \| 1\/1 \/ — \/ 1\/1 \|/);
  assert.match(out, /\| off \| large \| 1\/1 \|/);
});
