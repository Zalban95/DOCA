'use strict';

/**
 * Long commands (harness/jobs.js): `shell` waits at most `shellTimeoutSec`,
 * and anything longer runs as a background job the agent follows with
 * `shell_job` — instead of dying at 60 s, or being split into `sleep` calls.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H       = require('./helpers');
const tools   = require('../modules/harness/tools');
const jobs    = require('../modules/harness/jobs');
const catalog = require('../modules/harness/catalog');

test.before(() => H.start());
test.after(() => { for (const j of jobs.list()) jobs.stop(j.id); return H.stop(); });

const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 50)); }
  return false;
};

test('a shell call waits at most shellTimeoutSec, and says what to do instead', async () => {
  catalog.saveConfig(catalog.BUILTIN_ID, { shellTimeoutSec: 1 });
  const t = Date.now();
  const out = await tools.call('shell', { command: 'sleep 5; echo never' });
  assert.ok(Date.now() - t < 4000, 'stopped at the limit, not at 5 s');
  assert.match(out, /Timed out after 1s and was stopped\. For long commands use background: true/);
  assert.match(tools.TOOLS.find(x => x.name === 'shell').description, /waits at most 1 s/);

  catalog.saveConfig(catalog.BUILTIN_ID, { shellTimeoutSec: 60 });
  assert.match(await tools.call('shell', { command: 'echo quick', timeoutSec: 5 }), /exit 0\nquick/);
});

test('a background job returns at once, keeps running, and its output and exit code can be read', async () => {
  const started = await tools.call('shell', { command: 'echo one; sleep 0.3; echo two; exit 3', background: true }, [], { sessionId: 'sj' });
  const id = /job_[0-9a-f]{10}/.exec(started)[0];
  assert.match(started, /Started background job job_/);
  assert.equal(jobs.get(id).state, 'running');

  assert.ok(await until(() => jobs.get(id).state === 'exited'), 'it finishes on its own');
  assert.match(await tools.call('shell_job', { action: 'status', id }), /exited \(exit 3\)/);
  assert.match(await tools.call('shell_job', { action: 'output', id }), /one\ntwo/);
  assert.match(await tools.call('shell_job', { action: 'list' }, [], { sessionId: 'sj' }), new RegExp(id));
  assert.match(await tools.call('shell_job', { action: 'list' }, [], { sessionId: 'other' }), /No background jobs/);
});

test('stop ends the job and what it started; a job whose process vanished says "gone"', async () => {
  const j = jobs.start('sleep 30 & sleep 30; wait', { sessionId: 'sj2' });
  assert.equal(jobs.get(j.id).state, 'running');
  assert.match(await tools.call('shell_job', { action: 'stop', id: j.id }), /stopped/);
  assert.ok(await until(() => { try { process.kill(j.pid, 0); return false; } catch { return true; } }), 'the process group is gone');

  // A restart lost its exit code: the record says running, the process is not there.
  const store = require('../modules/store');
  const all = store.readJson('harness/jobs').jobs;
  all.push({ id: 'job_0000000000', command: 'x', pid: 999999, state: 'running', startedAt: new Date().toISOString() });
  store.writeJson('harness/jobs', { jobs: all });
  assert.equal(jobs.get('job_0000000000').state, 'gone');
  assert.match(await tools.call('shell_job', { action: 'status', id: 'nope' }), /^Error: No background job/);
});

test('only so many run at once', () => {
  const started = [];
  try {
    for (let i = 0; i < jobs.MAX_RUNNING; i++) started.push(jobs.start('sleep 30'));
    assert.throws(() => jobs.start('sleep 30'), /already running/);
  } finally { for (const j of started) jobs.stop(j.id); }
});
