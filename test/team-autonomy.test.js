'use strict';

/**
 * What kept a team from finishing on its own (2026-10-17, the Emberfall run): its members ran their test through the
 * project tool, piped into tail, as a background job or after a cd into their own worktree, and the hub counted none of
 * it — four members were given up with their work done; and one member failed because no model answered for one step.
 * Now every honest way of running the test counts (test-runs.js), and an outage pauses a mission and carries it on.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');   // first: it points the settings at a temporary folder (see its top)

const runs = () => require('../modules/teams/test-runs');
const call = (id, name, args) => ({ role: 'assistant', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const result = (id, content) => ({ role: 'tool', tool_call_id: id, content });

test('a test run counts however it was honestly run: cd into its own folder, settings, timeout, a filter read by its summary', () => {
  const { shape, verdict } = runs();
  assert.equal(shape('cd /w/game && npm test', 'npm test', '/w/game'), 'exact');
  assert.equal(shape("cd '/w/game'; PORT=41110 npm test 2>&1", 'npm test', '/w/game'), 'exact');
  assert.equal(shape('timeout 300 npm test > log', 'npm test'), 'exact');
  assert.equal(shape('cd /w/other && npm test', 'npm test', '/w/game'), null, 'another folder says nothing about this one');
  assert.equal(shape('cd /w/game && npm test', 'npm test'), null, 'a cd with no folder to compare is not trusted');
  assert.equal(shape('npm test 2>&1 | tail -80', 'npm test'), 'piped');
  assert.equal(shape('npm test', 'GAME_PLAN=full npm test'), null, 'a test that sets something is not run without it');
  assert.equal(shape('cd /w/game && GAME_PLAN=full npm test', 'GAME_PLAN=full npm test', '/w/game'), 'exact');
  for (const c of ['npm test || true', 'npm test | sort | tail', 'npm test && rm -rf x', 'npm test -- --grep x', 'npm test &', 'npm tests'])
    assert.equal(shape(c, 'npm test'), null, c);
  const piped = out => verdict('npm test', [{ command: 'npm test 2>&1 | tail -40', code: 0, output: out }]);
  assert.equal(piped('# tests 12\n# pass 12\n# fail 0\n').state, 'passed');
  assert.equal(piped('# pass 10\n# fail 2\n').state, 'failed');
  assert.equal(piped('Tests:       1 failed, 9 passed, 10 total').state, 'failed');
  assert.equal(piped('==== 14 passed in 0.31s ====').state, 'passed');
  assert.equal(piped('some output with no summary').state, 'unknown', 'a filter hides the exit, and nothing else says');
  assert.equal(verdict('npm test', [{ command: 'npm test', code: 0 }, { command: '', changes: true }]).state, 'unknown', 'a write after it');
});

test('the project tool\'s run and a background job are runs of the test too', () => {
  const { fromRows, verdict } = runs();
  const rows = [
    call('a', 'project', { action: 'run', command: 'test' }), result('a', 'npm test — exited (exit 1)\n# fail 3'),
    call('b', 'write_file', { path: 'src/x.js', content: 'x' }), result('b', 'Wrote 1 bytes'),
    call('c', 'shell_job', { action: 'wait', id: 'job_366c8516d6' }),
    result('c', 'job_366c8516d6 — exited (exit 0) — started 2026-10-17T21:33:51.401Z — cd /w/game && PORT=41110 npm test 2>&1 | tail -80\n# pass 61\n# fail 0\n# todo 42'),
  ];
  assert.deepEqual(verdict('npm test', fromRows(rows), '', { root: '/w/game' }), { state: 'passed', why: '`npm test` passed' });
  assert.equal(verdict('npm test', fromRows(rows.slice(0, 2))).state, 'failed', 'the project run said exit 1');
  assert.equal(verdict('npm test', fromRows(rows.slice(0, 4))).state, 'unknown', 'a write came after the last run');
});

/* An outage: no model answers a mission's step. */
let server, answers = [];
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const status = answers.length ? answers.shift() : 200;
      if (status !== 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"model failed to load"}}'); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Done: the errand.' } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(require('../modules/paths').CONFIG_PATH, JSON.stringify({ models: { providers: { tstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'tstub', model: 'm', fallbackChain: [], summarizeAfter: 0, maxSteps: 3 });
  const registry = require('../modules/agents/registry');
  registry.setEnabled(true);
  registry.save({ id: 'reader', label: 'Reader', role: 'You read and report.', kits: ['memory'], maxSteps: 3 });
});
after(async () => {
  server.closeAllConnections(); await new Promise(r => server.close(r));
  require('../modules/agents/registry').setEnabled(false);
  await H.stop();
});

async function until(fn, ms = 10000, what = 'the condition') {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 30)); }
}

test('no model answers: the mission pauses, carries on in its own conversation, and finishes; a lasting outage still fails it', async () => {
  const outage = require('../modules/agents/outage');
  outage.WAITS.splice(0, outage.WAITS.length, 150, 150);
  const missions = require('../modules/agents/missions');
  const lead = require('../modules/harness/memory').createSession('lead').id;
  answers = [503];
  const m = missions.dispatch({ agentId: 'reader', task: 'Read the README.', by: lead });
  const paused = await until(() => (missions.get(m.id).state === 'paused' ? missions.get(m.id) : null), 5000, 'the pause');
  assert.equal(paused.pausedFor, 'outage');
  assert.match(missions.block({ sessionId: lead }), /waiting for a model to answer again .* carries on by itself/);
  assert.doesNotMatch(missions.block({ sessionId: lead }), /continue it\?/, 'nobody is asked: it carries on by itself');
  const done = await until(() => (missions.get(m.id).state === 'done' ? missions.get(m.id) : null), 5000, 'the carry-on');
  assert.match(done.result, /Done: the errand/);
  assert.equal(done.outages, 1);

  answers = [503, 503, 503];
  const m2 = missions.dispatch({ agentId: 'reader', task: 'Read it again.', by: lead });
  const failed = await until(() => (missions.get(m2.id).state === 'failed' ? missions.get(m2.id) : null), 5000, 'the end of its waits');
  assert.match(failed.error, /no model answered after 2 waits/);
  const notes = require('../modules/activity').recent?.({ limit: 50 }) || [];
  if (notes.length) assert.ok(notes.some(n => /paused Reader .* no model answered/.test(n.what)), 'each pause is an activity line');
});

test('a task that gives up reaches its leader at once, and keep going asked again is a fresh round of tries', async () => {
  const teams = require('../modules/teams');
  const memory = require('../modules/harness/memory');
  const lead = memory.createSession('lead4').id;
  answers = [400, 400, 400];   // a refusal, not an outage: the member fails
  const made = await teams.create({ title: 'Gives up', tasks: [
    { id: 'a', agent: 'reader', task: 'Do a.' }, { id: 'b', agent: 'reader', task: 'Then b.', after: ['a'] }] }, { by: lead });
  await until(() => teams.get(made.id).tasks[0].gaveUp, 8000, 'the task to give up');
  const note = await until(() => (memory.getSession(lead).reports || []).find(r => r.outcome === 'task-failed' || r.outcome === 'failed'), 4000, 'the report');
  assert.match(note.text, /task a "Do a\." gave up|a .*failed/);
  const team = teams.get(made.id);
  team.loop = { on: false, rounds: 3, maxRounds: 3 };
  require('../modules/teams/store').save(team);
  answers = [];   // the model answers now
  await teams.keepGoing(made.id, true);
  assert.equal(teams.get(made.id).loop.rounds, 1, 'a fresh allowance: the retry it made is its first round');
  await until(() => teams.get(made.id).state === 'done', 8000, 'the team, carried on');
});
