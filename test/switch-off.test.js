'use strict';

// A refusal because a switch is off says which, and how it is switched on (modules/switch-off.js; asked 2026-10-13):
// the first missing switch first, then the next, then what must be set up rather than switched.

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

test.before(() => H.start());
test.after(() => H.stop());

test('the Library, from nothing: developer mode, then the experiment, then its model — each said with its switch', async () => {
  const E = require('../modules/experiments');
  E.setDeveloper(false); require('../modules/utils').savePrefs({ ...require('../modules/utils').loadPrefs(), experiments: {} });
  let r = await H.api(null, 'POST', '/api/library/run', {});
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'switch_off');
  assert.deepEqual([r.body.needs.what, r.body.needs.route, r.body.needs.password, r.body.needs.mayChange], ['Developer mode', '/api/experiments/developer', true, true]);
  assert.equal((await H.api(null, 'POST', r.body.needs.route, r.body.needs.body)).status, 200);
  r = await H.api(null, 'POST', '/api/library/run', {});
  assert.deepEqual([r.body.needs.what, r.body.needs.route], ['The Library', '/api/experiments/library']);
  assert.equal((await H.api(null, 'POST', r.body.needs.route, r.body.needs.body)).status, 200);
  r = await H.api(null, 'POST', '/api/library/run', {});
  assert.equal(r.body.needs.route, null, 'a model is set up, not switched: its page alone');
  assert.equal(r.body.needs.page, 'models');
});

test('someone who may not switch it is told so, and given no switch', async () => {
  const member = await H.signIn('member');
  require('../modules/experiments').setDeveloper(false);
  const r = await H.api(null, 'GET', '/api/library/search?q=boat', undefined, { Cookie: member.cookie });
  assert.equal(r.body.code, 'switch_off');
  assert.equal(r.body.needs.mayChange, false, 'a member is told, and offered no switch');
});

test('specialists off is a question with its own switch', async () => {
  require('../modules/agents/registry').setEnabled?.(false);
  const prefs = require('../modules/utils').loadPrefs();
  require('../modules/utils').savePrefs({ ...prefs, agents: { ...(prefs.agents || {}), enabled: false } });
  const r = await H.api(null, 'POST', '/api/harness/missions', { agentId: 'tester', task: 'look' });
  assert.equal(r.status, 409);
  assert.deepEqual([r.body.code, r.body.needs.route, r.body.needs.body], ['switch_off', '/api/harness/agents/enable', { enabled: true }]);
});
