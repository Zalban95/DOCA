'use strict';

/**
 * A page an agent serves is named where its job is (TODO B6b, audit aw 10): shell_job list says which address a running
 * job serves (machines/index.js served — Machines → Live's own list), so the agent opens or shows it without reading
 * the job's log.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

test('shell_job list names the page a running job serves', async () => {
  const jobs = require('../modules/harness/jobs'), machines = require('../modules/machines');
  const real = [jobs.list, machines.served];
  jobs.list = () => [{ id: 'job_web', state: 'running', code: null, startedAt: '2026-10-07T10:00:00Z', command: 'npm run dev' },
    { id: 'job_other', state: 'running', code: null, startedAt: '2026-10-07T10:01:00Z', command: 'npm test' }];
  machines.served = () => [{ jobId: 'job_web', url: 'http://127.0.0.1:5173/', port: 5173 }];
  try {
    const out = await require('../modules/harness/tools').call('shell_job', { action: 'list' }, [], { sessionId: 's1' });
    assert.match(out, /job_web — running .*npm run dev\n {4}serving http:\/\/127\.0\.0\.1:5173\/ \(Machines → Live shows it\)/);
    assert.match(out, /job_other — running .*npm test$/);
  } finally { [jobs.list, machines.served] = real; }
});
