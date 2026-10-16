'use strict';

/**
 * Every person has their own Orchestrator (the owner's decision of 2026-10-16; harness/own-main.js). A second admin's
 * and a member's devices, unnamed turns, work chats and missions go under their own; the reports and wakes of that work
 * reach their Orchestrator and their devices — never the hub owner's. The model is replaced by a recorder.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let memory, org, own, access, supervisor, devices, bus, admin, member;
let woken = [];
const settle = () => new Promise(r => setImmediate(() => setImmediate(r)));

before(async () => {
  await H.start();
  memory = require('../modules/harness/memory');
  org = require('../modules/harness/organization');
  own = require('../modules/harness/own-main');
  access = require('../modules/harness/session-access');
  supervisor = require('../modules/harness/supervisor');
  devices = require('../modules/api-v1/devices');
  bus = require('../modules/api-v1/bus');
  supervisor._setTurn(async (sessionId, message) => { woken.push({ sessionId, message }); return { text: `reply to ${message.slice(0, 30)}` }; });
  supervisor._setEnabled(true);
  // The hub's Orchestrator is the owner's: they wrote in it first.
  memory.updateSession(memory.mainSession().id, { person: { id: H.owner.user.id, orgId: H.owner.orgId } });
  admin = await H.signIn('admin');
  member = await H.signIn('member');
});
after(() => { supervisor._setEnabled(false); return H.stop(); });

const personOf = who => ({ id: who.user.id, orgId: who.orgId, role: who.role });
function deviceOf(who, name) {
  const d = H.mkDevice(name, 'phone', H.PHONE_CAPS).device;
  return devices.update(d.id, { userId: who.user.id, orgId: who.orgId });
}

test('a second admin and a member each get an Orchestrator of their own; the owner keeps the hub\'s', () => {
  const hub = memory.mainSession().id;
  assert.equal(own.of(personOf(H.owner)), hub);
  const a = own.of(personOf(admin)), m = own.of(personOf(member));
  assert.ok(a && m && a !== hub && m !== hub && a !== m);
  assert.equal(own.of(personOf(admin)), a, 'made once, then found');
  assert.ok(own.isMain(a) && own.isMain(m) && own.isMain(hub));
  assert.deepEqual(own.all().slice().sort(), [hub, a, m].sort());
  // A conversation's unnamed turn: the owner's pointer, everyone else's own.
  assert.equal(access.defaultFor(personOf(admin)), a);
  assert.equal(access.defaultFor(personOf(member)), m);
});

test('a device with no conversation named goes to its person\'s Orchestrator (api-v1 defaultSession)', () => {
  const harness = require('../modules/api-v1/harness');
  assert.equal(harness.defaultSession(deviceOf(admin, 'Admin phone')).id, own.of(personOf(admin)));
  assert.equal(harness.defaultSession(deviceOf(member, 'Member phone')).id, own.of(personOf(member)));
  assert.equal(harness.defaultSession(deviceOf(H.owner, 'Owner phone')).id, memory.mainSession().id);
});

test('work a person starts goes under their Orchestrator, and its report wakes theirs alone', async () => {
  const mine = own.of(personOf(admin)), hub = memory.mainSession().id;
  const work = org.create({ title: 'Admin test run', person: personOf(admin) });
  assert.equal(work.parentId, mine);
  assert.equal(access.ownerOf(work.id), admin.user.id);
  assert.ok(!org.ancestors(work.id).includes(hub), 'not in the owner\'s reporting line');
  // A work chat made from the admin's Orchestrator with no person named (the hand-off) goes there too.
  assert.equal(org.create({ title: 'Handed off', from: mine }).parentId, mine);

  memory.updateSession(work.id, { job: { state: 'working', since: new Date().toISOString(), autoTurns: 0, idleTurns: 0 } });
  const ownerPhone = deviceOf(H.owner, 'Owner wrist'), adminPhone = deviceOf(admin, 'Admin wrist');
  woken = [];
  await org.tool({ action: 'report', outcome: 'failed', message: 'the build broke' }, { sessionId: work.id });
  assert.equal(supervisor.decide(work.id, { steps: 2 }), 'woken');
  await settle(); await settle();
  assert.deepEqual(woken.map(w => w.sessionId), [mine], 'the admin\'s Orchestrator, not the owner\'s');
  const heard = id => bus.drain(id, 0).events.filter(e => e.type === 'agent.turn' && e.payload.by === 'panel' && e.payload.sessionId === mine);
  assert.equal(heard(adminPhone.id).length, 1, 'the admin\'s device hears it');
  assert.equal(heard(ownerPhone.id).length, 0, 'the owner\'s device does not');
  assert.equal(supervisor.deliver(hub), 'nothing due');
});

test('an Orchestrator leads its own person\'s work and sees no one else\'s', () => {
  const hub = memory.mainSession().id, mine = own.of(personOf(member));
  const ownersWork = org.create({ title: 'Owner job', person: personOf(H.owner) });
  const membersWork = org.create({ title: 'Member job', person: personOf(member) });
  assert.equal(ownersWork.parentId, hub);
  assert.ok(org.canManage(mine, membersWork.id));
  assert.ok(!org.canManage(mine, ownersWork.id), 'the member\'s Orchestrator cannot steer the owner\'s work');
  assert.ok(!org.canManage(hub, membersWork.id), 'nor the owner\'s Orchestrator the member\'s');
  assert.ok(!org.list({ all: true }, mine).sessions.some(s => s.id === ownersWork.id));
  assert.equal(org.list({}, mine).main, mine);
});

test('a mission sent from the panel goes under the sender\'s Orchestrator', () => {
  const registry = require('../modules/agents/registry');
  const prefs = require('../modules/utils').loadPrefs();
  require('../modules/utils').savePrefs({ ...prefs, agents: { ...(prefs.agents || {}), enabled: true } });
  const def = registry.list()[0];
  const m = require('../modules/agents/missions').dispatch({ agentId: def.id, task: 'look', person: personOf(member) });
  assert.equal(memory.getSession(m.sessionId).parentId, own.of(personOf(member)));
  require('../modules/harness/agent').cancel(m.sessionId);
});

test('Clear puts a person\'s own Orchestrator away; what it led follows the new one', () => {
  const old = own.of(personOf(member));
  const child = org.create({ title: 'Led', person: personOf(member) });
  const next = own.reset(personOf(member));
  assert.notEqual(next.id, old);
  assert.equal(memory.getSession(child.id).parentId, next.id);
  assert.throws(() => org.archive(next.id), /stays available/);
  assert.throws(() => org.archive(old, false), /Each person has one Orchestrator at a time/);
});
