'use strict';

/**
 * Models for people, the owner's decisions of 2026-10-16 (second round): "nothing assigned" is a rule of its own, apart
 * from "not set"; the card saves every row at once with one password; and the agent knows it all — `people_models`
 * shows the policy and prepares the change a person asked for as a card whose Accept asks the password. No password,
 * no change; never applied from a turn.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let pm, as, utils, member, member2, admin, tool;
before(async () => {
  await H.start();
  pm = require('../modules/people-models');
  as = require('../modules/people-models/assign');
  utils = require('../modules/utils');
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'pa', model: 'owner-model' });
  member = await H.signIn('member', 'marco@test.local');
  require('../modules/auth/store').updateUser(member.user.id, { name: 'Marco' });
  member2 = await H.signIn('member');
  admin = await H.signIn('admin');
  tool = require('../modules/harness/toolbox/people-models').find(t => t.name === 'people_models');
});
after(() => H.stop());

const personOf = who => ({ id: who.user.id, orgId: who.orgId, role: who.role, name: who.user.name || who.role });
const as_ = who => ({ Cookie: who.cookie, 'X-Doca-Password': who.password, 'X-Doca-Notice': 'continue' });
const policy = v => utils.savePrefs({ ...utils.loadPrefs(), peopleModels: v });

test('"nothing assigned" stops the broader rules; "not set" passes to them', () => {
  policy({ assign: true, all: 'pc/everyone', levels: { member: 'pc/members' } });
  assert.equal(pm.assignedFor(personOf(member)).model, 'members');
  as.set(personOf(admin), { personId: member.user.id, model: 'none' });
  const r = pm.ruleFor(personOf(member));
  assert.deepEqual({ none: r.none, setBy: r.setBy, from: r.from }, { none: true, setBy: 'admin', from: 'person' });
  assert.equal(pm.assignedFor(personOf(member)), null, 'the owner\'s level rule no longer reaches them');
  assert.equal(pm.apply(require('../modules/harness/turn/params').params(), { person: personOf(member) }).model, 'owner-model', 'the policy without one: the owner\'s models');
  as.set(personOf(admin), { personId: member.user.id, model: '' });
  assert.equal(pm.assignedFor(personOf(member)).model, 'members', 'not set: the next rule decides');
  policy({ assign: true, all: 'pc/everyone', levels: { member: 'none' } });
  assert.equal(pm.assignedFor(personOf(member2)), null, 'the owner\'s "nothing" for a level stops "everyone"');
  policy({ assign: true, people: { [member.user.id]: 'pc/owner-pick' } });
  as.set(personOf(admin), { personId: member.user.id, model: 'none' });
  assert.equal(pm.assignedFor(personOf(member)).model, 'owner-pick', 'the owner\'s rule for the person still comes first');
  as.set(personOf(admin), { personId: member.user.id, model: '' });
});

test('the card saves several rows at once with one password, all or nothing', async () => {
  policy({ assign: true });
  const v = await H.api(null, 'GET', '/api/people-models', undefined, as_(admin));
  assert.ok(v.body.people.find(p => p.id === member.user.id).options.includes('pa/owner-model'), 'the picker offers the models allotted to them');
  assert.match(v.body.rule, /Nothing assigned/);
  const bad = await H.api(null, 'POST', '/api/people-models/assign', { changes: [{ personId: member.user.id, model: 'pc/x' }, { personId: admin.user.id, model: 'pc/y' }] }, as_(admin));
  assert.equal(bad.status, 403);
  assert.match(bad.body.error, /Change 2/);
  assert.equal(as.load().people[member.user.id], undefined, 'nothing written when one change is refused');
  const ok = await H.api(null, 'POST', '/api/people-models/assign', { changes: [{ personId: member.user.id, model: 'pc/x' }, { levelId: 'member', model: 'none' }] }, as_(admin));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(as.load().levels.member.model, 'none');
  const nopass = await H.api(null, 'POST', '/api/people-models/assign', { changes: [{ personId: member.user.id, model: '' }] }, { ...as_(admin), 'X-Doca-Password': '' });
  assert.equal(nopass.status, 401);
  await H.api(null, 'POST', '/api/people-models/assign', { changes: [{ personId: member.user.id, model: '' }, { levelId: 'member', model: '' }] }, as_(admin));
});

test('the agent shows the policy and whom its person may assign', () => {
  const out = tool.run({ action: 'show' }, { user: personOf(admin) });
  assert.match(out, /first rule that is set decides/i);
  assert.match(out, /Marco/);
  assert.match(out, /strictly below/);
  assert.match(out, /Other people's work/);
  assert.match(tool.run({ action: 'show' }, { user: personOf(member) }), /may not assign/);
  assert.match(tool.run({ action: 'propose', changes: [{ person: 'admin', model: 'pa/owner-model' }] }, { user: personOf(member) }), /^Error: .*may not assign/);
});

test('a person\'s request becomes a card: nothing changes until they accept it with their password', async () => {
  const s = require('../modules/harness/memory').createSession('mine', { activate: false, kind: 'chat' });
  const out = tool.run({ action: 'propose', reason: 'Give Marco the cheap model', changes: [{ person: 'Marco', model: 'pa/owner-model' }, { everyone_below: true, model: 'nothing' }] },
    { user: personOf(admin), sessionId: s.id, byPerson: true });
  assert.match(out, /^Proposed \(p_/);
  const id = out.match(/\((p_[a-z0-9]+)\)/)[1];
  assert.equal(as.load().people[member.user.id], undefined, 'not applied by the turn');
  const p = require('../modules/harness/settings').find(id);
  assert.equal(p.kind, 'people-models');
  assert.equal(p.sessionId, s.id, 'the card lands in that conversation');
  assert.ok(p.changes.some(c => c.to === 'nothing assigned'));
  const byMember = await H.api(null, 'POST', `/api/harness/proposals/${id}/apply`, {}, as_(member));
  assert.equal(byMember.status, 403, 'a member decides no one\'s models');
  const nopass = await H.api(null, 'POST', `/api/harness/proposals/${id}/apply`, {}, { ...as_(admin), 'X-Doca-Password': '' });
  assert.equal(nopass.status, 401, 'no password, no change');
  assert.equal(as.load().people[member.user.id], undefined);
  const ok = await H.api(null, 'POST', `/api/harness/proposals/${id}/apply`, {}, as_(admin));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(as.load().people[member.user.id].model, 'pa/owner-model');
  assert.equal(as.load().levels.member.model, 'none');
  assert.ok(require('../modules/agents/registry').NEVER.includes('people_models'), 'never a specialist\'s');
});

test('Unattended does not apply it either', () => {
  const approval = require('../modules/harness/approval');
  approval.setMode('unattended', { role: 'owner', confirm: 'unattended' });
  assert.equal(approval.isUnattended(), true);
  const out = tool.run({ action: 'propose', changes: [{ person: 'Marco', model: 'not set' }] }, { user: personOf(admin), byPerson: true });
  assert.match(out, /^Proposed/);
  assert.equal(as.load().people[member.user.id].model, 'pa/owner-model');
  approval.setMode('auto');
});
