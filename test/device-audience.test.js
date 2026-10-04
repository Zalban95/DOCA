'use strict';

// A conversation's news reaches the devices of the people it belongs to, and hosts (session-access.js hears).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const devices = require('../modules/api-v1/devices');
const bus = require('../modules/api-v1/bus');

let member, mine, theirs, legacy;
before(async () => {
  await H.start();
  member = await H.signIn('member');
  mine = H.mkDevice('owner phone', 'phone', H.PHONE_CAPS).device;
  devices.update(mine.id, { userId: H.owner.user.id, orgId: H.owner.orgId });
  theirs = H.mkDevice('member phone', 'phone', H.PHONE_CAPS).device;
  devices.update(theirs.id, { userId: member.user.id, orgId: member.orgId });
  legacy = H.mkDevice('old token', 'phone', H.PHONE_CAPS).device;
});
after(() => H.stop());

const types = (d, type) => bus.drain(d.id, 0).events.filter(e => e.type === type);

test('a mission in the owner\'s conversation is told to the owner\'s devices, not the member\'s', () => {
  const memory = require('../modules/harness/memory');
  const access = require('../modules/harness/session-access');
  const lead = memory.createSession('owner lead', { activate: false });
  access.claim({ ...H.owner.user, role: 'owner' }, lead.id);
  const spec = memory.createSession('spec', { activate: false, kind: 'specialist', parentId: lead.id });
  require('../modules/agents/missions').announce({ id: 'msn_aud', agentId: 'scout', label: 'Scout', task: 't', state: 'running', sessionId: spec.id, by: lead.id });
  assert.equal(types(mine, 'agent.mission').filter(e => e.payload.missionId === 'msn_aud').length, 1);
  assert.equal(types(legacy, 'agent.mission').filter(e => e.payload.missionId === 'msn_aud').length, 1, 'a device paired to nobody is not narrowed');
  assert.equal(types(theirs, 'agent.mission').filter(e => e.payload.missionId === 'msn_aud').length, 0);
});

test('the member\'s work chat is told to the member, and to the host', () => {
  const org = require('../modules/harness/organization');
  const access = require('../modules/harness/session-access');
  const s = org.create({ title: 'member work' });
  access.claim({ ...member.user, role: 'member' }, s.id);
  require('../modules/harness/workview').announce(s.id);
  const got = d => types(d, 'agent.mission').some(e => e.payload.missionId === s.id);
  assert.equal(got(theirs), true);
  assert.equal(got(mine), true, 'the owner holds host');
  const list = require('../modules/harness/workview').forDevices({}, devices.get(theirs.id)).missions.map(m => m.missionId);
  assert.ok(list.includes(s.id));
  assert.ok(!list.includes('msn_aud') , 'the owner\'s mission is not in the member\'s list');
});
