'use strict';

/**
 * Restarting without cutting work off (harness/drain.js): the panel says what
 * is running, can hold a restart until it ends, and starts no automatic work
 * while it waits.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H          = require('./helpers');
const drain      = require('../modules/harness/drain');
const lifecycle  = require('../modules/harness/turn/lifecycle');
const memory     = require('../modules/harness/memory');
const supervisor = require('../modules/harness/supervisor');

test.before(() => H.start());
test.after(() => { drain.cancel(); lifecycle.running.clear(); supervisor._setEnabled(false); return H.stop(); });

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); }
  return false;
};

test('busy() names what is running, and a waiting action runs once it ends', async () => {
  const s = memory.createSession('Laya build', { activate: false });
  lifecycle.running.set(s.id, Object.assign(new AbortController(), { auto: true }));
  assert.deepEqual(drain.busy().map(t => [t.title, t.auto]), [['Laya build', true]]);

  let ran = 0;
  const w = drain.whenIdle(() => { ran++; }, { label: 'restart', pollMs: 20 });
  assert.equal(w.label, 'restart');
  assert.equal(w.waitingOn.length, 1);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(ran, 0, 'not while the turn runs');

  supervisor._setEnabled(true);
  assert.equal(supervisor.wake('anything', 'x'), 'draining', 'no automatic work while a restart waits');
  supervisor._setEnabled(false);

  lifecycle.running.delete(s.id);
  assert.ok(await until(() => ran === 1), 'runs when the turn ends');
  assert.equal(drain.pending(), null);
});

test('it goes ahead at the deadline, and can be called off', async () => {
  const s = memory.createSession('Never ends', { activate: false });
  lifecycle.running.set(s.id, new AbortController());
  let ran = 0;
  drain.whenIdle(() => { ran++; }, { maxWaitMs: 80, pollMs: 20 });
  assert.ok(await until(() => ran === 1), 'at the deadline, even though it still runs');

  drain.whenIdle(() => { ran++; }, { pollMs: 20 });
  assert.equal(drain.cancel(), true);
  await new Promise(r => setTimeout(r, 80));
  assert.equal(ran, 1, 'called off');
  lifecycle.running.delete(s.id);
});

test('the routes: what is running, a restart that waits, and calling it off', async () => {
  const s = memory.createSession('Busy one', { activate: false });
  lifecycle.running.set(s.id, new AbortController());
  let r = await H.api(null, 'GET', '/api/harness/busy');
  assert.deepEqual(r.body.turns.map(t => t.title), ['Busy one']);
  assert.equal(r.body.pending, null);

  r = await H.api(null, 'POST', '/api/restart', { whenIdle: true });
  assert.equal(r.status, 202, 'waits instead of restarting');
  assert.equal(r.body.waiting.waitingOn[0].title, 'Busy one');
  assert.equal((await H.api(null, 'GET', '/api/harness/busy')).body.pending.label, 'restart');

  r = await H.api(null, 'POST', '/api/restart', { cancel: true });
  assert.deepEqual(r.body, { ok: true, cancelled: true });
  assert.equal((await H.api(null, 'GET', '/api/harness/busy')).body.pending, null);
  lifecycle.running.delete(s.id);
});
