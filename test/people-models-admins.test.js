'use strict';

/**
 * Admins assign models to the people below them (the owner's decision of 2026-10-16; people-models/assign.js): an
 * admin chooses their own model always, assigns to people and levels strictly below their own — never an equal, a
 * higher level or the owner — and never beyond what allot.js allots; where the owner and an admin both assign, the
 * owner's wins; each assignment says who set it; changes ask for the password.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let pm, utils, member, admin, admin2, intern;
before(async () => {
  await H.start();
  pm = require('../modules/people-models');
  utils = require('../modules/utils');
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'pa', model: 'owner-model' });
  member = await H.signIn('member');
  admin = await H.signIn('admin');
  admin2 = await H.signIn('admin');
  const L = require('../modules/auth/levels').create({ name: 'Interns', rights: ['read', 'chat'], tools: { allow: ['*'] }, resources: { model: ['pa/*'] } }, { actorLevel: 'owner' });
  intern = await H.signIn(L.id);
});
after(() => H.stop());

const personOf = who => ({ id: who.user.id, orgId: who.orgId, role: who.role, name: who.role });
const as = who => ({ Cookie: who.cookie, 'X-Doca-Password': who.password, 'X-Doca-Notice': 'continue' });
const assign = (who, body, extra = {}) => H.api(null, 'POST', '/api/people-models/assign', body, { ...as(who), ...extra });

test('an admin sees only the people and levels below them, and always chooses their own model', async () => {
  utils.savePrefs({ ...utils.loadPrefs(), peopleModels: { choose: false } });
  const r = await H.api(null, 'GET', '/api/people-models', undefined, as(admin));
  assert.equal(r.status, 200);
  const ids = r.body.people.map(p => p.id);
  assert.ok(ids.includes(member.user.id) && ids.includes(intern.user.id));
  assert.ok(!ids.includes(admin2.user.id), 'never an equal');
  assert.ok(!ids.includes(admin.user.id) && !ids.includes(H.owner.user.id), 'never themselves or the owner');
  assert.deepEqual(r.body.levels.map(l => l.id).sort(), ['member', 'viewer', intern.role].sort());
  assert.equal(r.body.policy.same, undefined, 'the owner\'s switches are the owner\'s');
  assert.equal(pm.mayChoose(personOf(admin)), true);
  const m = await H.api(null, 'GET', '/api/people-models', undefined, as(member));
  assert.equal(m.status, 403, 'a member assigns nothing');
});

test('an admin assigns below them, with who set it; an equal, the owner and themselves are refused', async () => {
  const ok = await assign(admin, { personId: member.user.id, model: 'pc/for-member' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const a = pm.assignedFor(personOf(member));
  assert.deepEqual({ m: `${a.provider}/${a.model}`, setBy: a.setBy, by: a.by }, { m: 'pc/for-member', setBy: 'admin', by: admin.user.id });
  const v = await H.api(null, 'GET', '/api/people-models', undefined, as(H.owner));
  const row = v.body.people.find(p => p.id === member.user.id);
  assert.equal(row.admin.byName, 'admin');
  assert.equal(row.counts.model, 'pc/for-member');
  assert.equal((await assign(admin, { personId: admin2.user.id, model: 'pc/x' })).status, 403);
  assert.equal((await assign(admin, { personId: H.owner.user.id, model: 'pc/x' })).status, 403);
  assert.equal((await assign(admin, { personId: admin.user.id, model: 'pc/x' })).status, 403);
  assert.equal((await assign(admin, { levelId: 'admin', model: 'pc/x' })).status, 403, 'not their own level');
  assert.equal((await assign(member, { personId: intern.user.id, model: 'pa/x' })).status, 403, 'a member is no admin');
});

test('never beyond what is allotted to that person', async () => {
  const no = await assign(admin, { personId: intern.user.id, model: 'pc/not-theirs' });
  assert.equal(no.status, 403);
  assert.match(no.body.error, /not allotted/);
  assert.equal((await assign(admin, { personId: intern.user.id, model: 'pa/theirs' })).status, 200);
  assert.equal((await assign(admin, { levelId: intern.role, model: 'pc/nope' })).status, 403, 'nor to their level');
});

test('the owner\'s wins where both assign, rule by rule from the most specific', async () => {
  await assign(admin, { levelId: 'member', model: 'pc/admin-level' });
  utils.savePrefs({ ...utils.loadPrefs(), peopleModels: { assign: true, all: 'pc/everyone', levels: { member: 'pc/owner-level' } } });
  let a = pm.assignedFor(personOf(member));
  assert.equal(`${a.provider}/${a.model}`, 'pc/for-member', 'an admin\'s for the person over the owner\'s for the level');
  assert.equal((await assign(H.owner, { personId: member.user.id, model: 'pc/owner-person' })).status, 200);
  a = pm.assignedFor(personOf(member));
  assert.deepEqual({ m: `${a.provider}/${a.model}`, setBy: a.setBy, by: a.by }, { m: 'pc/owner-person', setBy: 'owner', by: H.owner.user.id });
  assert.equal(utils.loadPrefs().peopleModels.people[member.user.id], 'pc/owner-person', 'the owner\'s goes into the policy');
  await assign(H.owner, { personId: member.user.id, model: '' });
  await assign(admin, { personId: member.user.id, model: '' });
  a = pm.assignedFor(personOf(member));
  assert.equal(`${a.provider}/${a.model}`, 'pc/owner-level', 'the owner\'s for the level over an admin\'s for it');
  utils.savePrefs({ ...utils.loadPrefs(), peopleModels: { assign: true, all: 'pc/everyone' } });
  assert.equal(pm.assignedFor(personOf(member)).model, 'admin-level', 'an admin\'s for the level over the owner\'s for everyone');
});

test('changes ask for the password, and the policy itself stays the owner\'s', async () => {
  const no = await assign(admin, { personId: member.user.id, model: 'pc/x' }, { 'X-Doca-Password': '' });
  assert.equal(no.status, 401);
  const prefs = await H.api(null, 'POST', '/api/prefs', { peopleModels: { same: false } }, as(admin));
  assert.equal(prefs.status, 403);
  assert.match(prefs.body.error, /owner/);
  assert.notEqual(utils.loadPrefs().peopleModels.same, false);
});
