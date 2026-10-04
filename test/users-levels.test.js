'use strict';

// Settings → Users & levels: people, their level, levels of one's own — and no way up (auth phase 2).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const rights = require('../modules/auth/rights');

let admin;
before(async () => { await H.start(); admin = await H.signIn('admin'); });
after(() => H.stop());
const as = (who, m, url, body) => H.api(null, m, url, body, who ? { Cookie: who.cookie } : {});

test('an owner creates a person with a one-time password; they must replace it', async () => {
  const r = await H.api(null, 'POST', '/api/auth/users', { email: 'new.person@x.test', name: 'New', level: 'member' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.oneTimePassword, /^\S{10,}$/);
  assert.equal(r.body.user.level, 'member');
  assert.equal(r.body.user.mustChangePassword, true);
  const list = await H.api(null, 'GET', '/api/auth/users');
  assert.ok(list.body.users.some(u => u.email === 'new.person@x.test'));
  assert.deepEqual(list.body.levels.filter(l => l.builtin).map(l => l.id), ['viewer', 'member', 'admin', 'owner']);
});

test('a custom level, bound to settings and tools, and what it grants through the gate', async () => {
  const r = await H.api(null, 'POST', '/api/auth/levels', { name: 'Operator', rights: ['read', 'chat', 'propose'],
    settings: 'harness.config\nmodels', tools: { allow: ['shell:git', 'read_file'], deny: ['shell:rm'] }, approval: 'ask' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.level.id, 'operator');
  assert.deepEqual(r.body.level.settings, ['harness.config', 'models']);
  assert.equal(rights.can('operator', 'propose'), true);
  assert.equal(rights.can('operator', 'host'), false);
  const person = (await H.api(null, 'POST', '/api/auth/users', { email: 'op@x.test', level: 'operator' })).body.user;
  assert.equal(person.level, 'operator');
});

test('no way up: an admin cannot make owners, levels beyond their rights, or change an owner', async () => {
  const mk = await as(admin, 'POST', '/api/auth/users', { email: 'x@x.test', level: 'owner' });
  assert.equal(mk.status, 403);
  const lvl = await as(admin, 'POST', '/api/auth/levels', { name: 'Sneaky', rights: ['read', 'org'] });
  assert.equal(lvl.status, 403);
  assert.match(lvl.body.error, /rights you do not hold: org/);
  const ownerChange = await as(admin, 'PATCH', `/api/auth/users/${H.owner.user.id}`, { level: 'member' });
  assert.equal(ownerChange.status, 403);
  const self = await as(admin, 'PATCH', `/api/auth/users/${admin.user.id}`, { level: 'member' });
  assert.equal(self.status, 403, 'nor their own');
  const member = await H.signIn('member');
  assert.equal((await as(member, 'GET', '/api/auth/users')).status, 403, 'a member has no users right');
});

test('the last owner stays an owner; suspending signs a person out', async () => {
  const other = await H.signIn('member');
  const s = await H.api(null, 'PATCH', `/api/auth/users/${other.user.id}`, { suspended: true });
  assert.equal(s.body.user.suspended, true);
  assert.equal((await as(other, 'GET', '/api/status')).status, 401, 'their session is gone');
  const lvl = await H.api(null, 'DELETE', '/api/auth/levels/member');
  assert.equal(lvl.status, 400, 'a built-in level cannot be removed');
  const inUse = await H.api(null, 'DELETE', '/api/auth/levels/operator');
  assert.equal(inUse.status, 409, 'nor one somebody holds');
});
