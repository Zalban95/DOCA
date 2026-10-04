'use strict';

// Whose conversation is this (harness/session-access.js, live test 2026-10-04): a person without
// host sees and uses only their own, and does not move the host's "active" conversation.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let member, other;
before(async () => { await H.start(); member = await H.signIn('member'); other = await H.signIn('member'); });
after(() => H.stop());

const as = who => ({ Cookie: who.cookie });

test('a member makes a conversation of their own; the host\'s active one does not move', async () => {
  const before = await H.api(null, 'GET', '/api/harness/sessions');
  const made = await H.api(null, 'POST', '/api/harness/sessions', { title: 'mine' }, as(member));
  assert.equal(made.status, 200);
  const id = made.body.session.id;
  const after = await H.api(null, 'GET', '/api/harness/sessions');
  assert.equal(after.body.active, before.body.active, 'the host\'s active conversation stayed');
  assert.ok(after.body.sessions.some(s => s.id === id), 'the host sees it');

  const mine = await H.api(null, 'GET', '/api/harness/sessions', undefined, as(member));
  assert.deepEqual(mine.body.sessions.map(s => s.id), [id], 'the member sees only theirs');
  assert.equal(mine.body.active, id);
  assert.equal((await H.api(null, 'GET', `/api/harness/sessions/${id}`, undefined, as(member))).status, 200);

  assert.equal((await H.api(null, 'GET', `/api/harness/sessions/${id}`, undefined, as(other))).status, 404, 'another member: as if it did not exist');
  assert.equal((await H.api(null, 'GET', `/api/harness/sessions/${before.body.main}`, undefined, as(member))).status, 404, 'nor the Orchestrator');
  assert.equal((await H.api(null, 'DELETE', `/api/harness/sessions/${id}`, undefined, as(other))).status, 404);
  assert.equal((await H.api(null, 'GET', `/api/harness/runs?sessionId=${before.body.main}`, undefined, as(member))).status, 404);
  assert.equal((await H.api(null, 'GET', `/api/harness/sessions/${id}`)).status, 200, 'the host opens anyone\'s');
});

test('a host writing in a member\'s conversation does not take it from them', () => {
  const memory = require('../modules/harness/memory');
  const access = require('../modules/harness/session-access');
  const { withPerson } = require('../modules/harness/turn/client');
  const s = memory.createSession('theirs', { activate: false });
  access.claim({ ...member.user, role: 'member' }, s.id);
  withPerson({ user: { ...H.owner.user, role: 'owner' } }, s.id);
  assert.equal(access.ownerOf(s.id), member.user.id);
  assert.equal(access.mayUse({ ...member.user, role: 'member' }, s.id), true);
  assert.equal(access.mayUse({ ...other.user, role: 'member' }, s.id), false);
});

test('a turn with no conversation named goes to the member\'s own, never the host\'s active one', () => {
  const access = require('../modules/harness/session-access');
  const memory = require('../modules/harness/memory');
  const fresh = { id: 'usr_nobody_yet', role: 'member' };
  const active = memory.setActive(memory.mainSession().id);
  const id = access.defaultFor(fresh);
  assert.notEqual(id, active);
  assert.equal(memory.activeSession().id, active);
  assert.equal(access.ownerOf(id), fresh.id);
  assert.equal(access.defaultFor(fresh), id, 'and the same one next time');
});

test('a member reads the shared memory but does not edit it; /me says which rights they hold (live test)', async () => {
  assert.equal((await H.api(null, 'GET', '/api/harness/memory', undefined, as(member))).status, 200);
  assert.equal((await H.api(null, 'POST', '/api/harness/memory', { key: 'k', value: 'v' }, as(member))).status, 403);
  assert.equal((await H.api(null, 'DELETE', '/api/harness/memory/anything', undefined, as(member))).status, 403);
  const me = await H.api(null, 'GET', '/api/auth/me', undefined, as(member));
  assert.deepEqual(me.body.rights, ['read', 'chat']);
});

test('a member\'s agent recalls only the member\'s conversations (live test)', () => {
  const memory = require('../modules/harness/memory');
  const recall = require('../modules/harness/recall');
  const access = require('../modules/harness/session-access');
  const theirs = memory.createSession('zebra notes, theirs', { activate: false });
  access.claim({ ...member.user, role: 'member' }, theirs.id);
  const owners = memory.createSession('zebra notes, the owner\'s', { activate: false });
  access.claim({ ...H.owner.user, role: 'owner' }, owners.id);
  const m = { ...member.user, role: 'member' };
  assert.deepEqual(recall.search('zebra', { person: m }).map(h => h.id), [theirs.id]);
  assert.equal(recall.search('zebra', { person: { ...H.owner.user, role: 'owner' } }).length, 2, 'a host recalls all');
  assert.throws(() => recall.read(owners.id, { person: m }), /No conversation/);
});

test('what acts on nothing needs no place in a level (work_chats, memory_search)', () => {
  const permits = require('../modules/auth/permits');
  require('../modules/auth/levels').create({ name: 'Nothing', rights: ['read', 'chat'], tools: { allow: [] }, approval: 'ask' }, { actorLevel: 'owner' });
  const p = { ...member.user, role: 'nothing' };
  assert.deepEqual(permits.tool({ person: p, name: 'work_chats', args: { action: 'report' } }), { allowed: true, ask: false });
  assert.equal(permits.tool({ person: p, name: 'shell', args: { command: 'ls' } }).allowed, false);
});
