'use strict';

/**
 * Unattended mode (modules/harness/approval.js): the owner's switch for a test
 * bench, where the agent's own proposals apply without a click. Only the owner,
 * only confirmed, never proposable, always audited.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H        = require('./helpers');
const approval = require('../modules/harness/approval');
const settings = require('../modules/harness/settings');
const tools    = require('../modules/harness/tools');
const authStore = require('../modules/auth/store');

test.before(() => H.start());
test.after(async () => { approval.setMode('auto'); await H.stop(); });

test('only the owner, and only with the confirmation, can turn it on', async () => {
  assert.throws(() => approval.setMode('unattended', { role: 'admin', confirm: 'unattended' }), { status: 403 });
  assert.throws(() => approval.setMode('unattended', { role: 'owner' }), { status: 400 });
  const admin = await H.signIn('admin');
  const r = await H.api(null, 'POST', '/api/harness/approval', { mode: 'unattended', confirm: 'unattended' }, { Cookie: admin.cookie });
  assert.equal(r.status, 403);
  const ok = await H.api(null, 'POST', '/api/harness/approval', { mode: 'unattended', confirm: 'unattended' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.mode, 'unattended');
  assert.ok(authStore.auditTail(10).some(e => e.action === 'approval mode: unattended'));
});

test('in unattended mode the agent\'s settings proposal applies at once, and is audited', async () => {
  approval.setMode('unattended', { role: 'owner', confirm: 'unattended' });
  const path = settings.readable()[0].path;
  const value = settings.readable()[0].value;
  const next = typeof value === 'number' ? value + 1000 : value;
  const out = await tools.call('settings_propose', { reason: 'bench test', changes: [{ path, value: next }] }, [], { sessionId: 's_test' });
  assert.match(out, /^Applied at once — unattended mode is on/);
  assert.equal(settings.readable().find(r => r.path === path).value, next, 'the change is in effect');
  assert.ok(authStore.auditTail(10).some(e => e.action === 'unattended: settings applied'));
});

test('the mode is not something the agent can propose, and one click takes it back to auto', async () => {
  assert.equal(settings.readable().some(r => /approval/.test(r.path)), false);
  const r = await H.api(null, 'POST', '/api/harness/approval', { mode: 'auto' });
  assert.equal(r.body.mode, 'auto');
  const out = await tools.call('settings_propose', { reason: 'x', changes: [{ path: settings.readable()[0].path, value: settings.readable()[0].value }] }, [], {});
  assert.match(out, /^Proposed/, 'back to waiting for a click');
});

test('setting up the harness settings for the first time keeps the approval mode', () => {
  const { loadPrefs, savePrefs } = require('../modules/utils');
  const prefs = loadPrefs();
  prefs.harness = { approval: { mode: 'manual', always: ['shell:git'] } };   // chosen before any harness existed
  savePrefs(prefs);
  require('../modules/harness/catalog').configFor('doca');                  // the first read seeds the rest
  assert.deepEqual(approval.settings(), { mode: 'manual', always: ['shell:git'] });
  approval.setMode('auto');
});
