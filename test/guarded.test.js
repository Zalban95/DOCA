'use strict';

/**
 * Important and safety switches ask for the password, every time (CONSTITUTION S14; TODO P1.11; auth/guarded.js):
 * a recent sign-in is not enough, a wrong password is refused under the sign-in rate limit, an ordinary setting
 * asks nothing, and the agent never applies a guarded setting by itself — not when asked, not in Unattended.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const prefs = () => require('../modules/utils').loadPrefs();
const without = { 'X-Doca-Password': '' };

test('a switch without the password: 401 naming it; a wrong one: 403; the right one: done', async () => {
  let r = await H.api(null, 'POST', '/api/harness/approval', { mode: 'manual' }, without);
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'password_required');
  assert.match(r.body.error, /approval mode/);
  r = await H.api(null, 'POST', '/api/harness/approval', { mode: 'manual' }, { 'X-Doca-Password': 'not-it' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'bad_credentials');
  require('../modules/auth/routes')._failures.clear();
  r = await H.api(null, 'POST', '/api/harness/approval', { mode: 'manual' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await H.api(null, 'POST', '/api/harness/approval', { mode: 'auto' });
  assert.equal(r.status, 200);
});

test('POST /api/prefs asks only when a guarded setting would change', async () => {
  let r = await H.api(null, 'POST', '/api/prefs', { theme: 'light' }, without);
  assert.equal(r.status, 200, 'an ordinary setting asks nothing');
  r = await H.api(null, 'POST', '/api/prefs', { experiments: { ...(prefs().experiments || {}), retrieval: true } }, without);
  assert.equal(r.status, 401);
  assert.match(r.body.error, /experiment/);
  r = await H.api(null, 'POST', '/api/prefs', { experiments: prefs().experiments || {} }, without);
  assert.equal(r.status, 200, 'sending a guarded setting back unchanged asks nothing');
});

test('a conversation\'s approval switch asks; its title does not', async () => {
  const { switchOf } = require('../modules/auth/guarded');
  const req = body => ({ method: 'POST', path: '/api/harness/sessions/abc/settings', body });
  assert.equal(switchOf(req({ title: 'x' })), null);
  assert.match(switchOf(req({ approval: 'auto' })), /approval/);
  assert.equal(switchOf({ method: 'POST', path: '/api/harness/guards/test', body: {} }), null, 'testing a guard flips nothing');
  assert.match(switchOf({ method: 'DELETE', path: '/api/auth/grants/g1', body: {} }), /grants/);
});

test('the agent never applies a guarded setting alone: asked, or in Unattended, it stays a proposal', async () => {
  const tools = require('../modules/harness/tools');
  const owner = { ...H.owner.user, role: 'owner' };
  const before = prefs().agents?.enabled;
  const out = await tools.call('settings_propose', { reason: 'they asked', changes: [{ path: 'agents.enabled', value: !before }], asked: true },
    [], { byPerson: true, user: owner });
  assert.match(out, /^Proposed .*password/s);
  assert.equal(prefs().agents?.enabled, before);
  const id = out.match(/Proposed \((\w+)\)/)[1];
  let r = await H.api(null, 'POST', `/api/harness/proposals/${id}/apply`, {}, without);
  assert.equal(r.status, 401, 'its Accept asks for the password');
  r = await H.api(null, 'POST', `/api/harness/proposals/${id}/apply`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(prefs().agents?.enabled, !before);
});
