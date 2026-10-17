'use strict';

/**
 * What the panel starts on request outlives a restart or an update of DOCA, and goes down when DOCA really stops
 * unless it was asked to stay up (the owner's rule, 2026-10-17; outlive.js, harness/jobs.js, service-life/shutdown.js).
 * Found when a game an agent served went dark at a version switch: under systemd every restart ended DOCA's group.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const fs = require('node:fs');
const path = require('node:path');

test.after(() => H.stop());

const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await H.sleep(100); } return false; };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('a job writes its exit code beside its log, so it is known when DOCA was not there to hear it end', { skip: process.platform === 'win32' && 'POSIX shells' }, async () => {
  await H.start();
  const jobs = require('../modules/harness/jobs');
  const j = jobs.start('exit 3', {});
  assert.ok(await until(() => jobs.get(j.id).state === 'exited'), 'it ended');
  assert.equal(jobs.get(j.id).code, 3);
  const code = path.join(path.dirname(require('../modules/store').dir('harness/jobs')), 'jobs', `${j.id}.code`);
  assert.equal(fs.readFileSync(code, 'utf8').trim(), '3', 'the exit code is on disk too');
  // As DOCA sees it after a restart: a running record whose process is gone, read from the file.
  const store = require('../modules/store');
  const all = store.readJson('harness/jobs', { jobs: [] }).jobs.map(x => (x.id === j.id ? { ...x, state: 'running', code: undefined } : x));
  store.writeJson('harness/jobs', { jobs: all });
  const seen = jobs.list().find(x => x.id === j.id);
  assert.deepEqual([seen.state, seen.code], ['exited', 3]);
});

test('DOCA really stopping stops the jobs it started, but not one kept; a switch going back stops nothing', { skip: process.platform === 'win32' && 'no signal reaches DOCA there' }, async () => {
  const jobs = require('../modules/harness/jobs'), shutdown = require('../modules/service-life/shutdown');
  const a = jobs.start('sleep 30', {}), kept = jobs.start('sleep 30', { keep: true });
  assert.ok(await until(() => alive(a.pid) && alive(kept.pid)));
  // A switch going back (`.releases/pending`): nothing the panel started is touched.
  const pending = path.join(H.tmp, 'pending'); fs.writeFileSync(pending, 'v1');
  await shutdown.onSignal('SIGTERM', { exit: () => {}, pending });
  assert.equal(jobs.get(a.id).state, 'running', 'a switch going back is not a stop');
  // DOCA stopping: the job goes, the kept one stays.
  await shutdown.onSignal('SIGTERM', { exit: () => {}, pending: path.join(H.tmp, 'no-pending') });
  assert.equal(jobs.get(a.id).state, 'stopped');
  assert.ok(await until(() => !alive(a.pid)), 'its process is gone');
  assert.equal(jobs.get(kept.id).state, 'running', 'a job started with keep stays up');
  jobs.stop(kept.id);
});

const userSystemd = () => {
  if (process.platform !== 'linux') return false;
  const which = require('../modules/shell').which;
  return !!which('systemd-run') && fs.existsSync(`/run/user/${process.getuid()}/bus`);
};

test('under systemd a job runs in a unit of the person\'s own, outside DOCA\'s group, and is still stopped by its PID', { skip: !userSystemd() && 'no user systemd here' }, async () => {
  const outlive = require('../modules/outlive');
  process.env.DOCA_OUTLIVE = 'systemd-user'; outlive._reset();
  try {
    assert.equal(outlive.mode(), 'systemd-user');
    const jobs = require('../modules/harness/jobs');
    const j = jobs.start('echo "$DOCA_JOB here"; sleep 30', {});
    assert.match(j.unit || '', /^doca-job-/);
    assert.ok(j.pid && alive(j.pid), 'its process runs');
    const cg = fs.readFileSync(`/proc/${j.pid}/cgroup`, 'utf8');
    assert.match(cg, /user@\d+\.service\/.*doca-job-/, 'in the person\'s own manager, not DOCA\'s group');
    assert.ok(await until(() => /here/.test(jobs.output(j.id))), 'its output reaches its log, its environment by name');
    jobs.stop(j.id);
    assert.ok(await until(() => !alive(j.pid)), 'stopped by its PID');
    const k = jobs.start('exit 7', {});
    assert.ok(await until(() => jobs.get(k.id).state === 'exited'), 'a quick one ends');
    assert.equal(jobs.get(k.id).code, 7, 'its exit code read from its file');
  } finally { delete process.env.DOCA_OUTLIVE; outlive._reset(); }
});
