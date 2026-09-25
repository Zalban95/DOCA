'use strict';

/**
 * The contract of modules/auth/store.js — every query, as callers rely on it.
 *
 * Decided 2026-09-25: JSON now, a database later, and the move must cost one
 * file. That holds only if the second implementation is proven by the same
 * tests as the first — so these talk to the module's functions and never to
 * its files. Point AUTH_STORE at another implementation and run this file.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

require('./helpers');   // an isolated data directory
const S = require(process.env.AUTH_STORE || '../modules/auth/store');

test('users: created once per address, found case-insensitively, updated in place', () => {
  const before = S.userCount();
  const u = S.createUser({ email: ' Ada@Example.test ', name: 'Ada', passwordHash: 'h' });
  assert.match(u.id, /^usr_[0-9a-f]{16}$/);
  assert.equal(u.email, 'ada@example.test');
  assert.equal(S.userCount(), before + 1);
  assert.equal(S.userByEmail('ADA@example.TEST').id, u.id);
  assert.equal(S.userById(u.id).name, 'Ada');
  assert.throws(() => S.createUser({ email: 'ada@example.test', passwordHash: 'h' }), { status: 409 });
  assert.throws(() => S.createUser({ email: '', passwordHash: 'h' }), { status: 400 });
  assert.equal(S.updateUser(u.id, { name: 'Ada L.', id: 'ignored' }).id, u.id, 'the id is not writable');
  assert.equal(S.userById(u.id).name, 'Ada L.');
  assert.equal(S.updateUser('usr_missing', { name: 'x' }), null);
  assert.equal(S.userByEmail('nobody@example.test'), null);
});

test('organisations and memberships: the first org is the default; one membership per user and org', () => {
  const first = S.defaultOrg() || S.createOrg('First');
  S.createOrg('Second');
  assert.equal(S.defaultOrg().id, first.id, 'the oldest is the default');
  const u = S.createUser({ email: 'm@example.test', passwordHash: 'h' });
  S.addMembership({ orgId: first.id, userId: u.id, role: 'member', status: 'pending' });
  assert.equal(S.membership(first.id, u.id).status, 'pending');
  assert.equal(S.membership(first.id, u.id).approvedAt, null);
  S.addMembership({ orgId: first.id, userId: u.id, role: 'admin', status: 'active', approvedBy: 'usr_x' });
  assert.equal(S.membershipsOf(u.id).length, 1, 'replaced, not duplicated');
  assert.equal(S.membership(first.id, u.id).role, 'admin');
  assert.ok(S.membership(first.id, u.id).approvedAt);
});

test('sessions: by hash, updated, deleted one at a time or all but one, expired ones pruned', () => {
  const u = S.createUser({ email: 's@example.test', passwordHash: 'h' });
  const future = new Date(Date.now() + 3600e3).toISOString(), past = new Date(Date.now() - 1000).toISOString();
  S.createSession('h1', { userId: u.id, orgId: 'o', expiresAt: future });
  S.createSession('h2', { userId: u.id, orgId: 'o', expiresAt: future });
  S.createSession('h3', { userId: u.id, orgId: 'o', expiresAt: past });
  assert.equal(S.sessionByHash('h1').userId, u.id);
  assert.ok(S.sessionByHash('h1').createdAt);
  S.updateSession('h1', { stepUpAt: 'now' });
  assert.equal(S.sessionByHash('h1').stepUpAt, 'now');
  S.pruneSessions();
  assert.equal(S.sessionByHash('h3'), null, 'expired');
  S.deleteSessionsOf(u.id, 'h1');
  assert.equal(S.sessionByHash('h2'), null);
  assert.ok(S.sessionByHash('h1'), 'the one kept');
  S.deleteSession('h1');
  assert.equal(S.sessionByHash('h1'), null);
});

test('audit: appended, read back in order, never rewritten', () => {
  S.audit({ action: 'first', actorId: 'a' });
  S.audit({ action: 'second', actorId: 'a' });
  const tail = S.auditTail(2);
  assert.deepEqual(tail.map(e => e.action), ['first', 'second']);
  assert.ok(tail.every(e => e.at));
});
