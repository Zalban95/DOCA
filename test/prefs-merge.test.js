'use strict';

// POST /api/prefs merges leaf by leaf (deep test A, c B1): a partial body used to wipe the rest of its top-level key —
// `{"harness":{"config":{"doca":{"temperature":0.3}}}}` took the agent's model, prompt and limits with it. Null deletes;
// `?replace=1` is the old whole-key replace; the password guard reads the same merge.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

before(() => H.start());
after(() => H.stop());

const u = () => require('../modules/utils');
const seed = extra => u().savePrefs({ ...u().loadPrefs(), harness: { config: { doca: { provider: 'p1', model: 'm1', temperature: 0.7, maxSteps: 12 } }, approval: { mode: 'manual' } }, ...extra });

test('a partial body leaves its siblings alone', async () => {
  seed();
  const r = await H.api(null, 'POST', '/api/prefs', { harness: { config: { doca: { temperature: 0.3 } } } }, { 'X-Doca-Password': '' });
  assert.equal(r.status, 200, 'no guarded switch changes, so no password is asked');
  const h = u().loadPrefs().harness;
  assert.deepEqual(h.config.doca, { provider: 'p1', model: 'm1', temperature: 0.3, maxSteps: 12 });
  assert.equal(h.approval.mode, 'manual');
});

test('null deletes a key; an array replaces; ?replace=1 replaces whole top-level keys', async () => {
  seed({ sidebarStats: { cpu: true, gpu: false }, hiddenTabs: ['a', 'b'] });
  await H.api(null, 'POST', '/api/prefs', { sidebarStats: { gpu: null }, hiddenTabs: ['c'] });
  let p = u().loadPrefs();
  assert.deepEqual(p.sidebarStats, { cpu: true });
  assert.deepEqual(p.hiddenTabs, ['c']);
  await H.api(null, 'POST', '/api/prefs?replace=1', { sidebarStats: { ram: true } });
  p = u().loadPrefs();
  assert.deepEqual(p.sidebarStats, { ram: true });
  assert.equal(p.harness.config.doca.model, 'm1', 'other keys untouched');
});

test('the guard asks when the merge would change a switch, and only then', async () => {
  seed();
  const without = { 'X-Doca-Password': '' };
  assert.equal((await H.api(null, 'POST', '/api/prefs', { harness: { approval: { mode: 'auto' } } }, without)).status, 401);
  assert.equal((await H.api(null, 'POST', '/api/prefs', { harness: { approval: null } }, without)).status, 401, 'deleting a switch is changing it');
  assert.equal((await H.api(null, 'POST', '/api/prefs?replace=1', { harness: { config: {} } }, without)).status, 401, 'a replace that drops it too');
  assert.equal(u().loadPrefs().harness.approval.mode, 'manual');
  assert.equal((await H.api(null, 'POST', '/api/prefs', { harness: { approval: { mode: 'auto' } } })).status, 200, 'with the password');
  assert.equal(u().loadPrefs().harness.approval.mode, 'auto');
});

test('a prototype key is never merged', () => {
  const out = require('../modules/prefs-merge').merged({ a: { b: 1 } }, JSON.parse('{"__proto__":{"x":1},"a":{"constructor":{"y":2},"c":3}}'));
  assert.deepEqual(out, { a: { b: 1, c: 3 } });
  assert.equal({}.x, undefined);
});
