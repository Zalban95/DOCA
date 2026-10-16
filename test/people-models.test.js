'use strict';

/**
 * Models for people (the owner's decision of 2026-10-16; modules/people-models): the people of a hub run on the
 * owner's models, choose their own, or run on one the owner assigns — any combination, guarded by the password, and
 * always before auth/allot.narrowModel, so it never loosens what a person is allotted.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let pm, utils, catalog, memory, member, admin;
before(async () => {
  await H.start();
  pm = require('../modules/people-models');
  utils = require('../modules/utils');
  catalog = require('../modules/harness/catalog');
  memory = require('../modules/harness/memory');
  catalog.saveConfig(catalog.BUILTIN_ID, { provider: 'pa', model: 'owner-model', fallbackChain: [{ provider: 'pb', model: 'backup' }] });
  member = await H.signIn('member');
  admin = await H.signIn('admin');
});
after(() => H.stop());

const personOf = who => ({ id: who.user.id, orgId: who.orgId, role: who.role, name: who.role });
const policy = v => utils.savePrefs({ ...utils.loadPrefs(), peopleModels: v });
const base = () => require('../modules/harness/turn/params').params();

test('by default people run on the owner\'s models, and may not choose their own', () => {
  policy(undefined);
  const p = base();
  assert.equal(pm.apply(p, { person: personOf(member) }), p);
  assert.equal(pm.mayChoose(personOf(member)), false);
  assert.equal(pm.mayChoose(personOf(admin)), true, 'admins always may');
  assert.deepEqual({ ...pm.effective(personOf(member)), note: undefined }, { provider: 'pa', model: 'owner-model', why: 'owner', mayChoose: false, note: undefined });
});

test('assigned models: a person over their level over everyone; the owner is never assigned', () => {
  policy({ assign: true, all: 'pc/everyone', levels: { member: 'pc/members' }, people: { [admin.user.id]: 'pb/backup' } });
  const p = base();
  const m = pm.apply(p, { person: personOf(member) });
  assert.equal(`${m.provider}/${m.model}`, 'pc/members');
  assert.equal(m._assigned, 'level');
  assert.deepEqual(m.fallbackChain.map(e => `${e.provider}/${e.model}`), ['pa/owner-model', 'pb/backup'], 'the owner\'s order follows it');
  const a = pm.apply(p, { person: personOf(admin) });
  assert.equal(`${a.provider}/${a.model}`, 'pb/backup');
  assert.equal(a._assigned, 'person');
  assert.equal(pm.apply(p, { person: personOf(H.owner) }), p, 'the owner runs on their own');
  // An assigned model answers every step: the owner's mastermind/worker arrangement is not theirs.
  assert.equal(pm.routes(personOf(member)), false);
  assert.equal(pm.routes(personOf(H.owner)), true);
  assert.equal(pm.effective(personOf(member)).why, 'assigned:level');
});

test('with "same" off and nothing assigned or chosen, a person has no model and is told why', () => {
  policy({ same: false, assign: true, levels: { admin: 'pc/admins' } });
  assert.throws(() => pm.apply(base(), { person: personOf(member) }), e => e.code === 'no_model' && /Models for people/.test(e.message));
  assert.equal(pm.effective(personOf(member)).why, 'none');
  assert.equal(pm.apply(base(), { person: personOf(admin) }).model, 'admins');
});

test('a person\'s own choice counts only where choosing is allowed; a stuck job\'s escalation always does', () => {
  const s = memory.createSession('theirs', { activate: false, kind: 'chat' });
  require('../modules/harness/session-access').claim(personOf(member), s.id);
  memory.updateSession(s.id, { modelChoice: { provider: 'pc', model: 'picked', fallback: true } });
  const choice = require('../modules/harness/turn/choice');
  policy({ choose: false });
  assert.equal(choice.apply(base(), s.id).model, 'owner-model', 'not allowed: the choice is set aside');
  memory.updateSession(s.id, { job: { state: 'working', escalated: true } });
  assert.equal(choice.apply(base(), s.id).model, 'picked', 'the hub\'s escalation is not a person\'s choice');
  memory.updateSession(s.id, { job: null });
  policy({ choose: true, assign: true, all: 'pc/everyone' });
  const p = choice.apply(base(), s.id);
  assert.equal(pm.apply(p, { person: personOf(member), sessionId: s.id }).model, 'picked', 'their choice wins over an assignment');
});

test('the chat\'s picker: refused and hidden unless allowed', async () => {
  const s = memory.createSession('mine', { activate: false, kind: 'chat' });
  require('../modules/harness/session-access').claim(personOf(member), s.id);
  const as = { Cookie: member.cookie, 'X-Doca-Password': '' };
  policy({ choose: false });
  const view = await H.api(null, 'GET', `/api/harness/sessions/${s.id}/model`, undefined, as);
  assert.equal(view.status, 200);
  assert.equal(view.body.mayChoose, false);
  const no = await H.api(null, 'POST', `/api/harness/sessions/${s.id}/model`, { provider: 'pa', model: 'x' }, as);
  assert.equal(no.status, 403);
  assert.match(no.body.error, /Models for people/);
  policy({ choose: true });
  const yes = await H.api(null, 'POST', `/api/harness/sessions/${s.id}/model`, { provider: 'pa', model: 'x' }, as);
  assert.doesNotMatch(String(yes.body.error || ''), /has not let people choose/);
});

test('changing the policy asks for the password', async () => {
  const body = { peopleModels: { same: true, choose: true, assign: false, all: '', levels: {}, people: {} } };
  policy(undefined);
  const without = await H.api(null, 'POST', '/api/prefs?replace=1', body, { 'X-Doca-Password': '' });
  assert.equal(without.status, 401);
  assert.equal(without.body.code || without.body.error?.code || 'password_required', 'password_required');
  const ok = await H.api(null, 'POST', '/api/prefs?replace=1', body);
  assert.equal(ok.status, 200);
  assert.equal(require('../modules/settings-schema').value('peopleModels.choose'), true);
  assert.ok(require('../modules/settings-schema').unproposable('peopleModels.choose'), 'never the agent\'s to propose');
});

test('a device reads its person\'s model on /api/v1/settings/effective, read-only', async () => {
  policy({ assign: true, levels: { member: 'pc/members' } });
  const d = H.mkDevice('Member phone', 'phone', H.PHONE_CAPS);
  require('../modules/api-v1/devices').update(d.device.id, { userId: member.user.id, orgId: member.orgId });
  const r = await H.api(null, 'GET', '/api/v1/settings/effective', undefined, { Authorization: `Bearer ${d.token}`, Cookie: '' });
  assert.equal(r.status, 200);
  assert.deepEqual({ provider: r.body.model.provider, model: r.body.model.model, why: r.body.model.why }, { provider: 'pc', model: 'members', why: 'assigned:level' });
});
