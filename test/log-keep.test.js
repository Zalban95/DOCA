'use strict';

// What the hub keeps of what happened (modules/log-keep.js, TODO P1.12): every store with its bounds and what it
// holds, the bounds as declared settings, enforced — rings in memory, runs and traces, background jobs' output — and
// changed only by a host, within each setting's range.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

before(() => H.start());
after(() => H.stop());

const keep = () => require('../modules/log-keep');
const raw = () => require('../modules/db').syncHandle();

test('every store is listed with its bounds and how much it holds', async () => {
  const { status, body } = await H.api(null, 'GET', '/api/logs/keep');
  assert.equal(status, 200);
  const ids = body.stores.map(s => s.id);
  for (const id of ['harness', 'workstream', 'mcp', 'runs', 'traces', 'jobs', 'evals', 'checkpoints', 'migrations', 'outbox']) assert.ok(ids.includes(id), id);
  const runs = body.stores.find(s => s.id === 'runs');
  assert.equal(runs.settings[0].path, 'logs.runsRetainDays');
  assert.equal(runs.settings[0].value, 90);
  assert.ok(Number.isInteger(runs.entries));
  assert.ok(body.stores.find(s => s.id === 'outbox').fixed, 'a protocol limit is shown, not editable');
  const member = await H.signIn('member', 'logkeep-member@test.local');
  assert.equal((await H.api(null, 'GET', '/api/logs/keep', undefined, { Cookie: member.cookie })).status, 403);
});

test('a bound outside its range is refused; a good one is saved and applied at once', async () => {
  const bad = await H.api(null, 'POST', '/api/logs/keep', { values: { 'logs.harnessLines': 3 } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /from 50 to 20000/);
  assert.equal((await H.api(null, 'POST', '/api/logs/keep', { values: { 'tracing.enabled': false } })).status, 400, 'whether runs are traced is not switched here');
  assert.equal((await H.api(null, 'POST', '/api/logs/keep', { values: { 'harness.config': 1 } })).status, 400);
  const ok = await H.api(null, 'POST', '/api/logs/keep', { values: { 'logs.harnessLines': 60 } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(require('../modules/settings-schema').value('logs.harnessLines'), 60);
  const ring = require('../modules/logs')._ring;
  const agent = require('../modules/harness/agent');
  for (let i = 0; i < 80; i++) agent.events.emit('event', { type: 'warning', text: `w${i}`, sessionId: 's_logkeep' });
  assert.equal(ring.length, 60, 'the ring holds what the setting says');
  assert.equal(ring.at(-1).sessionId, 's_logkeep', 'a kept line says whose turn it was');
  await H.api(null, 'POST', '/api/logs/keep', { values: { 'logs.harnessLines': 500 } });
});

test('old runs go with their traces; past maxSpans the oldest spans go', async () => {
  const r = raw();
  r.prepare("INSERT INTO runs (id, kind, state, started_at, ended_at) VALUES ('run_ancient', 'turn', 'done', '2020-01-01T00:00:00.000Z', '2020-01-01T00:01:00.000Z')").run();
  r.prepare("INSERT INTO runs (id, kind, state, started_at) VALUES ('run_still', 'turn', 'running', '2020-01-01T00:00:00.000Z')").run();
  r.prepare("INSERT INTO trace_spans (run_id, seq, at, kind) VALUES ('run_ancient', 1, ?, 'model')").run(new Date().toISOString());
  const removed = keep().prune();
  assert.ok(removed.runs >= 1);
  assert.equal(require('../modules/harness/runs').get('run_ancient'), undefined);
  assert.deepEqual(require('../modules/harness/trace').spans('run_ancient'), [], 'its trace went with it');
  assert.ok(require('../modules/harness/runs').get('run_still'), 'a running one stays, however old');
  const u = require('../modules/utils');
  const ins = r.prepare("INSERT INTO trace_spans (run_id, seq, at, kind) VALUES ('run_many', ?, ?, 'tool')");
  const now = Date.now();
  for (let i = 1; i <= 1200; i++) ins.run(i, new Date(now - (1200 - i) * 1000).toISOString());
  u.savePrefs({ ...u.loadPrefs(), tracing: { ...(u.loadPrefs().tracing || {}), maxSpans: 1000 } });
  keep()._forget();
  try {
    keep().prune();
    const left = r.prepare("SELECT COUNT(*) AS n FROM trace_spans").get().n;
    assert.ok(left <= 1000, `${left} rows left`);
    assert.equal(r.prepare("SELECT MIN(seq) AS s FROM trace_spans WHERE run_id = 'run_many'").get().s > 1, true, 'the oldest went first');
  } finally { const p = u.loadPrefs(); delete p.tracing.maxSpans; u.savePrefs(p); keep()._forget(); }
});

test('background jobs keep to their bound, and an output file no record names is removed', () => {
  const dir = require('../modules/store').dir('harness/jobs');
  const stray = path.join(dir, 'job_strayfile00.log');
  fs.writeFileSync(stray, 'left behind');
  keep().prune();
  assert.equal(fs.existsSync(stray), false);
});
