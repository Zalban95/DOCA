'use strict';

/**
 * What the panel could do and a device could not (api-v1/parity.js; audit 2026-10-06, TODO C1/D1): stop, restart and
 * drop, archive, what is working, the person's day, the decisions waiting — as the device's owner, 404 for others'.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H       = require('./helpers');
const devices = require('../modules/api-v1/devices');
const memory  = require('../modules/harness/memory');
const access  = require('../modules/harness/session-access');

let phone, member, theirs;
test.before(async () => {
  await H.start();
  phone = H.mkDevice('Owner phone', 'phone', H.PHONE_CAPS);
  devices.update(phone.device.id, { userId: H.owner.user.id, orgId: H.owner.orgId });
  member = await H.signIn('member', 'parity-member@test.local');
  theirs = H.mkDevice('Member phone', 'phone', H.PHONE_CAPS);
  devices.update(theirs.device.id, { userId: member.user.id, orgId: member.orgId });
});
test.after(() => H.stop());

const v1 = (dev, method, path, body) => H.api(dev.token, method, `/api/v1${path}`, body);

test('restart and drop a work chat a person stopped; another person\'s is not there', async () => {
  const w = memory.createSession('Stopped job', { activate: false, kind: 'work', parentId: memory.mainSession().id });
  access.claim({ ...H.owner.user, role: 'owner' }, w.id);
  memory.updateSession(w.id, { state: 'idle', job: { state: 'stopped', stoppedWhy: 'Stopped from a phone' } });
  const working = await v1(phone, 'GET', '/harness/working');
  assert.equal(working.status, 200);
  assert.ok(working.body.stopped.some(s => s.sessionId === w.id));
  assert.equal((await v1(theirs, 'POST', `/harness/work/${w.id}/drop`)).status, 404, 'the member\'s phone cannot see it');
  const dropped = await v1(phone, 'POST', `/harness/work/${w.id}/drop`);
  assert.equal(dropped.status, 200);
  assert.equal(dropped.body.state, 'dropped');
  assert.match((await v1(phone, 'POST', `/harness/work/${w.id}/restart`)).body.note, /not stopped/);
});

test('a conversation is put away and brought back; a mission not running has nothing to stop', async () => {
  const s = memory.createSession('Archive me', { activate: false });
  access.claim({ ...H.owner.user, role: 'owner' }, s.id);
  assert.ok((await v1(phone, 'POST', `/harness/sessions/${s.id}/archive`)).body.session.archivedAt);
  assert.equal((await v1(phone, 'POST', `/harness/sessions/${s.id}/archive`, { on: false })).body.session.archivedAt, null);
  assert.equal((await v1(theirs, 'POST', `/harness/sessions/${s.id}/archive`)).status, 404);
  assert.equal((await v1(phone, 'POST', '/harness/missions/msn_nope/stop')).status, 404);
});

test('the person\'s day and the decisions waiting for them', async () => {
  const ambient = require('../modules/ambient');
  const real = ambient.today;
  ambient.today = async (p, o) => ({ weather: { place: o.place }, calendar: { events: [] }, notices: [], who: p?.id });
  try {
    const day = await v1(phone, 'GET', '/ambient?place=Bologna');
    assert.equal(day.status, 200);
    assert.deepEqual([day.body.weather.place, day.body.who], ['Bologna', H.owner.user.id]);
  } finally { ambient.today = real; }
  require('../modules/harness/installs').propose({ kind: 'service', id: 'whisper', reason: 'speech to text' });
  const mine = await v1(phone, 'GET', '/decisions');
  assert.ok(mine.body.decisions.some(d => d.kind === 'install'), 'a host\'s device sees the hive\'s decisions');
  assert.ok(!(await v1(theirs, 'GET', '/decisions')).body.decisions.some(d => d.kind === 'install'), 'a member\'s does not');
});
