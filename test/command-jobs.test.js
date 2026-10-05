'use strict';

// A device's command job (modules/api-v1/jobs.js) is a run (harness/runs.js, TODO H11.2): recorded when it starts and
// when it ends, readable after the in-memory copy is gone, and marked interrupted when a restart cut it off.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(() => H.start());
after(() => H.stop());

const settle = () => new Promise(r => setTimeout(r, 30));

test('a job is a run: its end, its output tail and its result outlive the memory that held it', async () => {
  const jobs = require('../modules/api-v1/jobs');
  const runs = require('../modules/harness/runs');
  const phone = H.mkDevice('Phone', 'phone', H.PHONE_CAPS);
  const ok = jobs.runAsJob('docker.ps', phone.device.id, (req, res) => { res.write('data: {"status":"listing"}\n\n'); res.json({ ok: true, count: 3 }); }, {}, { all: true });
  const bad = jobs.runAsJob('stack.up', phone.device.id, (req, res) => { res.write('data: "ERROR: compose file missing"\n\n'); res.end(); }, {}, {});
  await settle();
  assert.equal(runs.get(ok.id).kind, 'job');
  assert.equal(runs.get(ok.id).state, 'done');
  assert.equal(runs.get(bad.id).state, 'failed');
  jobs._reset();   // as after a restart, or past the cap
  const back = jobs.get(ok.id);
  assert.deepEqual({ status: back.status, commandId: back.commandId, params: back.params, result: back.result, output: back.output },
    { status: 'done', commandId: 'docker.ps', params: { all: true }, result: { ok: true, count: 3 }, output: ['listing'] });
  assert.match(jobs.get(bad.id).error, /compose file missing/);
  const r = await fetch(`${H.base}/api/v1/jobs/${ok.id}`, { headers: { Authorization: `Bearer ${phone.token}` } });
  assert.equal((await r.json()).job.status, 'done', 'GET /api/v1/jobs/:id reads it back from its run');
});

test('a job running when the hub restarts is marked interrupted, not running forever', () => {
  const runs = require('../modules/harness/runs');
  runs.begin({ id: 'job_restartcut', kind: 'job', detail: { commandId: 'models.pull' } });
  runs.recoverJobs();
  assert.equal(runs.get('job_restartcut').state, 'failed');
  assert.match(runs.get('job_restartcut').outcome, /interrupted by a restart/);
  assert.equal(require('../modules/api-v1/jobs').get('job_restartcut').status, 'failed');
});
