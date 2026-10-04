'use strict';

// One record of how each turn went, and the state compared to the plan (modules/harness/runs.js).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');
const runs = require('../modules/harness/runs');
const memory = require('../modules/harness/memory');

let server;
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'the final answer' } }] }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { rstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'rstub', model: 'm', fallbackChain: [], summarizeAfter: 0 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

test('every turn leaves one run: how it ended, readable by session', async () => {
  const s = memory.createSession('runs', { activate: false });
  const r = await require('../modules/harness/agent').turn({ message: 'hi', sessionId: s.id });
  assert.equal(r.ended, 'done');
  const list = (await H.api(null, 'GET', `/api/harness/runs?sessionId=${s.id}`)).body.runs;
  assert.equal(list[0].id, r.runId);
  assert.equal(list[0].state, 'done');
  assert.match(list[0].outcome, /the final answer/);
});

test('Stop landing after the last answer: the turn says cancelled, and so would its mission (audit 2026-10-04)', async () => {
  const s = memory.createSession('stopped late', { activate: false });
  const ctrl = new AbortController();
  const r = await require('../modules/harness/agent').turn({ message: 'hi', sessionId: s.id, signal: ctrl.signal,
    emit: e => { if (e.type === 'text') ctrl.abort(); } });
  assert.equal(r.ended, 'cancelled', 'the one value missions.run reads for its own state');
  assert.equal(runs.get(r.runId).state, 'cancelled');
  assert.equal(memory.getSession(s.id).state, 'cancelled');
});

test('a mission that ends done with plan items open is flagged and reported to whoever dispatched it', () => {
  const store = require('../modules/store');
  const org = require('../modules/harness/organization');
  const lead = org.create({ title: 'Lead' });
  const spec = memory.createSession('Spec', { activate: false, kind: 'specialist', parentId: lead.id });
  store.writeJson('agents/missions', { missions: [{ id: 'msn_plan', agentId: 'scribe', label: 'Scribe', by: lead.id, state: 'running', sessionId: spec.id,
    plan: [{ title: 'Read the logs', state: 'done' }, { title: 'Write the report', state: 'queued' }] }] });
  const id = runs.begin({ sessionId: spec.id, missionId: 'msn_plan' });
  runs.end(id, { state: 'done', outcome: 'done' });
  const check = runs.checkPlan(id);
  assert.deepEqual(check.open, ['Write the report (queued)']);
  assert.deepEqual(require('../modules/agents/missions').get('msn_plan').planCheck, ['Write the report (queued)']);
  assert.ok(org.notices(lead.id).some(n => /Plan check: Scribe \(msn_plan\) ended done with 1 plan item not done/.test(n.text)));
  store.writeJson('agents/missions', { missions: [] });
});

test('a delegated turn records the person it ran for, found above it (live test 2026-10-04)', async () => {
  const parent = memory.createSession('asked by the owner', { activate: false });
  memory.updateSession(parent.id, { person: { id: H.owner.user.id } });
  const child = memory.createSession('specialist', { activate: false, kind: 'specialist', parentId: parent.id });
  const r = await require('../modules/harness/agent').turn({ message: 'go', sessionId: child.id, client: { name: 'Delegated', kind: 'agent' } });
  assert.equal(runs.get(r.runId).personId, H.owner.user.id);
});
