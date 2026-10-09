'use strict';

// Turns a restart cut off (deep test A, #11): a run left "running" by a dead process is closed when DOCA starts — as
// stopped, saying why, with the steps and tokens its trace kept — so Chronicle no longer shows it running for ever.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

before(() => H.start());
after(() => H.stop());

test('a turn running when the hub restarted is closed with its tokens; a command job is left to recoverJobs', () => {
  const runs = require('../modules/harness/runs');
  const db = require('../modules/db').syncHandle();
  runs.begin({ id: 'run_cutturn', kind: 'turn', sessionId: 'ses_x' });
  runs.begin({ id: 'run_cutbare', kind: 'turn', sessionId: 'ses_y' });
  runs.begin({ id: 'job_stillmine', kind: 'job' });
  const span = (seq, data) => db.prepare('INSERT INTO trace_spans (run_id, seq, at, kind, name, step, ms, data) VALUES (?,?,?,?,?,?,?,?)')
    .run('run_cutturn', seq, new Date().toISOString(), 'model', 'p / m', seq, 10, JSON.stringify(data));
  span(1, { prompt: 1000, completion: 50 });
  span(2, { prompt: 1200, completion: 30 });
  assert.equal(runs.recoverTurns(), 2);
  const cut = runs.get('run_cutturn');
  assert.equal(cut.state, 'cancelled');
  assert.match(cut.outcome, /^interrupted: DOCA restarted/);
  assert.equal(cut.tokens, 2280);
  assert.equal(cut.steps, 2);
  assert.ok(cut.endedAt);
  const bare = runs.get('run_cutbare');
  assert.deepEqual([bare.state, bare.tokens, bare.steps], ['cancelled', null, null], 'no trace: no tokens claimed');
  assert.equal(runs.get('job_stillmine').state, 'running', 'jobs are recoverJobs\' own');
  assert.equal(runs.recoverTurns(), 0, 'once');
});

test('DOCA closes them when it starts, before anything is carried on', () => {
  const src = require('node:fs').readFileSync(require.resolve('../modules/boot.js'), 'utf8');
  assert.ok(src.indexOf('recoverTurns()') > 0 && src.indexOf('recoverTurns()') < src.indexOf("require('./agents/carry-on')"));
});
