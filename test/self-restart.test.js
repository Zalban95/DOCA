'use strict';

/**
 * What brings DOCA back after a restart (modules/self-restart.js). Deep test B found Restart a kill switch in a
 * container where node was not PID 1: `/.dockerenv` alone was taken as a restart policy.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

require('./helpers');
const { decide, unitOf } = require('../modules/self-restart');

const files = map => f => (f in map ? map[f] : null);
const none = () => false;

test('a container counts as a supervisor only when this node is its main process', () => {
  const docker = f => f === '/.dockerenv';
  assert.equal(decide({ env: {}, pid: 1, ppid: 0, exists: docker, read: files({}) }).name, 'container');
  // Behind tini or docker --init: the container ends with us, so its restart policy is what brings us back.
  assert.equal(decide({ env: {}, pid: 7, ppid: 1, exists: docker, read: files({ '/proc/1/comm': 'tini\n' }) }).name, 'container');
  // An agents' computer, a dev container, a shell entrypoint: PID 1 is something else and stays — hand off.
  assert.equal(decide({ env: {}, pid: 42, ppid: 41, exists: docker, read: files({ '/proc/1/comm': 'node\n' }) }).name, null);
  assert.equal(decide({ env: {}, pid: 42, ppid: 1, exists: docker, read: files({ '/proc/1/comm': 'node\n' }) }).name, null);
});

test('systemd restarts only its main process, and only with a policy that restarts a clean exit', () => {
  const cg = '0::/system.slice/openclaw-panel.service\n';
  const env = { INVOCATION_ID: 'x' };
  const read = files({ '/proc/self/cgroup': cg });
  assert.equal(decide({ env, pid: 20, ppid: 10, exists: none, read, state: () => ({ restart: 'always', mainPid: 10 }) }).name, 'systemd');
  const no = decide({ env, pid: 20, ppid: 10, exists: none, read, state: () => ({ restart: 'no', mainPid: 10 }) });
  assert.equal(no.name, undefined);
  assert.match(no.refuse, /Restart=no.*systemctl restart openclaw-panel\.service/);
  // Inside some other unit's cgroup but not its main process: on our own, a successor outlives us.
  assert.equal(decide({ env, pid: 20, ppid: 10, exists: none, read, state: () => ({ restart: 'no', mainPid: 3 }) }).name, null);
  // systemctl silent: DOCA's own unit is trusted by its name, any other is not.
  assert.equal(decide({ env, pid: 20, ppid: 10, exists: none, read, state: () => null }).name, 'systemd');
  const other = files({ '/proc/self/cgroup': '0::/system.slice/foo.service\n' });
  assert.equal(decide({ env, pid: 20, ppid: 10, exists: none, read: other, state: () => null }).name, null);
});

test('INVOCATION_ID inherited by a desktop terminal is not a supervisor', () => {
  const read = files({ '/proc/self/cgroup': '0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-term-1.scope\n' });
  assert.equal(decide({ env: { INVOCATION_ID: 'x' }, pid: 5, ppid: 4, exists: none, read, state: () => { throw new Error('not asked'); } }).name, null);
});

test('the unit is the leaf of the cgroup path, a user unit marked as such', () => {
  assert.deepEqual(unitOf('0::/system.slice/openclaw-panel.service'), { unit: 'openclaw-panel.service', user: false });
  assert.deepEqual(unitOf('0::/user.slice/user-1000.slice/user@1000.service/app.slice/doca.service'), { unit: 'doca.service', user: true });
  assert.equal(unitOf('0::/user.slice/user-1000.slice/user@1000.service'), null);
  assert.equal(unitOf(null), null);
});

test('pm2 and an operator who names the supervisor are trusted', () => {
  assert.equal(decide({ env: { pm_id: '0' }, exists: none, read: files({}) }).name, 'pm2');
  assert.equal(decide({ env: { DOCA_SUPERVISOR: 'nomad' }, exists: none, read: files({}) }).name, 'nomad');
  assert.equal(decide({ env: {}, pid: 9, ppid: 8, exists: none, read: files({}) }).name, null);
});
