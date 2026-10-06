'use strict';

/** Who may release DOCA unasked is the admin's setting (modules/releasing.js; CONSTITUTION W2). */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const releasing = require('../modules/releasing');

test.before(() => H.start());
test.after(() => H.stop());

test('a rule is a model family with an optional minimum version', () => {
  const rules = ['claude-opus >= 5', 'claude-fable >= 5', 'my-local-coder'];
  assert.equal(releasing.check('claude-opus-5-5', rules).unasked, true);
  assert.equal(releasing.check('claude-fable-5-1', rules).rule, 'claude-fable >= 5');
  assert.equal(releasing.check('claude-opus-4-1-20250805', rules).unasked, false, 'a date is not a version; 4.1 is under 5');
  assert.equal(releasing.check('claude-sonnet-5-5', rules).unasked, false, 'another family asks');
  assert.equal(releasing.check('claude-opusx-9', rules).unasked, false, 'a family is matched whole');
  assert.equal(releasing.check('my-local-coder-7b', rules).unasked, true, 'no minimum: any version');
  assert.equal(releasing.check('deepseek-chat', []).unasked, false, 'an empty list: everyone asks');
  assert.equal(releasing.parse('rm -rf >= x'), null);
});

test('the admin edits it in the panel; the default is Opus and Fable 5+; nobody else, and no agent, may', async () => {
  let r = await H.api(null, 'GET', '/api/developer/releasing?model=claude-opus-5-5');
  assert.deepEqual(r.body.rules, ['claude-opus >= 5', 'claude-fable >= 5']);
  assert.equal(r.body.unasked, true);
  r = await H.api(null, 'POST', '/api/developer/releasing', { rules: ['nonsense rule !!'] });
  assert.equal(r.status, 400);
  r = await H.api(null, 'POST', '/api/developer/releasing', { rules: [] });
  assert.deepEqual(r.body.rules, []);
  assert.match(releasing.sentence(), /every model asks/);
  r = await H.api(null, 'GET', '/api/developer/releasing?model=claude-opus-5-5');
  assert.equal(r.body.unasked, false, 'saved: now it asks');
  const member = await H.signIn('member', 'rel-member@test.local');
  assert.equal((await H.api(null, 'GET', '/api/developer/releasing', undefined, { Cookie: member.cookie })).status, 403);
  assert.ok(require('../modules/harness/settings').refuse('developer.releaseUnasked', ['x']), 'never proposable');
  await H.api(null, 'POST', '/api/developer/releasing', { rules: ['claude-opus >= 5', 'claude-fable >= 5'] });
});
