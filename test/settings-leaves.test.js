'use strict';

/**
 * Settings with no control anywhere got boxes (deep test B, R14): the panel reads their declarations and values by
 * name, a host's alone, never a secret.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H = require('./helpers');
test.before(() => H.start());
test.after(() => H.stop());

test('declared settings by name: type, bounds, default, hint and value; never a secret; a host\'s', async () => {
  const r = await H.api(null, 'GET', '/api/settings/leaves?paths=computers.maxRunning,mcpSettings.listTimeoutMs,limits.maxStepsCeiling,features.idleDays,updates.repo,channels.matrix.accessToken,nope.x');
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.leaves.map(l => [l.path, l]));
  assert.deepEqual(Object.keys(by).sort(), ['computers.maxRunning', 'features.idleDays', 'limits.maxStepsCeiling', 'mcpSettings.listTimeoutMs', 'updates.repo']);
  assert.equal(by['computers.maxRunning'].value, 4);
  assert.equal(by['computers.maxRunning'].type, 'integer');
  assert.equal(by['limits.maxStepsCeiling'].max, 1000);
  assert.equal(by['mcpSettings.listTimeoutMs'].default, 20000);
  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'GET', '/api/settings/leaves?paths=computers.maxRunning', undefined, { Cookie: member.cookie })).status, 403);
});
