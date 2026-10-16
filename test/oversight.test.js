'use strict';

/**
 * Other people's work in the header (the owner's decision of 2026-10-16; modules/oversight): a host sees the missions
 * and work chats of the people they may see, newest first with an unread count, in fixed words — apart from their own
 * notices, never pushed to a device, opt-in (on for the owner by default).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let memory, access, member, admin;
before(async () => {
  await H.start();
  memory = require('../modules/harness/memory');
  access = require('../modules/harness/session-access');
  member = await H.signIn('member');
  admin = await H.signIn('admin');
});
after(() => H.stop());

const personOf = who => ({ id: who.user.id, orgId: who.orgId, role: who.role, name: who.role });
const as = who => ({ Cookie: who.cookie, 'X-Doca-Password': '' });
const work = (title, who, fields = {}) => {
  const s = memory.createSession(title, { activate: false, kind: 'work' });
  access.claim(personOf(who), s.id);
  memory.updateSession(s.id, fields);
  return s.id;
};

test('the owner follows by default and sees a member\'s work, never their own', async () => {
  const theirs = work('Build the report', member, { state: 'failed', lastError: 'The build broke' });
  const mine = work('My own errand', H.owner);
  const r = await H.api(null, 'GET', '/api/oversight');
  assert.equal(r.status, 200);
  assert.equal(r.body.on, true);
  const it = r.body.items.find(i => i.sessionId === theirs);
  assert.ok(it, 'the member\'s work chat is listed');
  assert.equal(it.event, 'failed');
  assert.equal(it.who, 'member');
  assert.match(it.text, /member's work chat failed/);
  assert.ok(!r.body.items.some(i => i.sessionId === mine), 'never their own');
  assert.ok(r.body.unread >= 1);
  const seen = await H.api(null, 'POST', '/api/oversight/seen', {});
  assert.equal(seen.body.unread, 0);
});

test('newest first, a stopped job and a proposed plan in their words', async () => {
  const stopped = work('Stopped one', member, { job: { state: 'stopped', stoppedWhy: 'Stopped by member' } });
  const plan = work('Planned one', member, { plan: { state: 'proposed', steps: ['a'] } });
  const r = await H.api(null, 'GET', '/api/oversight');
  const ev = id => r.body.items.find(i => i.sessionId === id)?.event;
  assert.equal(ev(stopped), 'stopped');
  assert.match(r.body.items.find(i => i.sessionId === stopped).detail, /waits for its person/);
  assert.equal(ev(plan), 'waiting');
  const ats = r.body.items.map(i => i.at);
  assert.deepEqual(ats, [...ats].sort().reverse());
});

test('a member gets nothing; another admin opts in and hears no devices', async () => {
  assert.equal((await H.api(null, 'GET', '/api/oversight', undefined, as(member))).status, 403);
  const off = await H.api(null, 'GET', '/api/oversight', undefined, as(admin));
  assert.equal(off.status, 200);
  assert.equal(off.body.on, false, 'off by default for anyone but the owner');
  assert.deepEqual(off.body.items, []);
  const on = await H.api(null, 'POST', '/api/oversight/switch', { on: true }, as(admin));
  assert.equal(on.body.on, true);
  const id = work('After switching on', member, { state: 'idle', brief: 'Done it' });
  const r = await H.api(null, 'GET', '/api/oversight', undefined, as(admin));
  const it = r.body.items.find(i => i.sessionId === id);
  assert.equal(it.event, 'finished');
  assert.equal(it.unread, true);
  // Devices stay their person's own: an admin's phone does not hear a member's work chat.
  const d = H.mkDevice('Admin phone', 'phone', H.PHONE_CAPS);
  require('../modules/api-v1/devices').update(d.device.id, { userId: admin.user.id, orgId: admin.orgId });
  assert.equal(access.hears(require('../modules/api-v1/devices').get(d.device.id), id), false);
});

test('a mission reads in fixed words', () => {
  const o = require('../modules/oversight');
  assert.equal(o.fromMission({ id: 'm1', state: 'running', asking: { since: '2026-10-16T10:00:00Z', what: 'click Sign in' }, sessionId: 's', task: 'x', startedAt: '2026-10-16T09:00:00Z' }).event, 'waiting');
  assert.equal(o.fromMission({ id: 'm2', state: 'done', sessionId: 's', task: 'x\nmore', label: 'Tester', result: 'ok', startedAt: 'a', endedAt: 'b' }).title, 'Tester: x');
  assert.equal(o.fromMission({ id: 'm3', state: 'cancelled', sessionId: 's', task: 'x', startedAt: 'a' }).event, 'stopped');
});

test('an admin sees the owner\'s work too, grouped by person, the newest unread group first', async () => {
  const ada = await H.signIn('member');
  const owners = work('The owner\'s errand', H.owner, { state: 'failed', lastError: 'x' });
  await H.api(null, 'POST', '/api/oversight/seen', {}, as(admin));
  const older = work('Ada\'s first', ada, { state: 'idle', brief: 'ok' });
  await H.sleep(15);
  const newer = work('Ada\'s second', ada, { state: 'failed', lastError: 'no' });
  const r = await H.api(null, 'GET', '/api/oversight', undefined, as(admin));
  const g = r.body.groups;
  assert.ok(r.body.items.some(i => i.sessionId === owners), 'the owner\'s work is listed for an admin');
  assert.equal(g[0].personId, ada.user.id, 'the person with the newest unread first');
  assert.deepEqual(g[0].items.map(i => i.sessionId).slice(0, 2), [newer, older], 'newest first within the group');
  assert.equal(g[0].unread, 2);
  const ownerGroup = g.find(x => x.personId === H.owner.user.id);
  assert.ok(ownerGroup && ownerGroup.unread === 0, 'read before: in its own group, after the unread ones');
  assert.ok(g.indexOf(ownerGroup) > 0);
  assert.equal(new Set(g.map(x => x.personId)).size, g.length, 'one group per person');
});
