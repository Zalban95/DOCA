'use strict';

/**
 * Team leaders set budgets for their people (CONSTITUTION S13; TODO P1.10; spending/budgets.js leads): a level with
 * delegate whose delegates name `budget` sets budgets for people of its level or below — a slot of its own, the tightest
 * wins, so it narrows what an admin set and never loosens it; never the owner, never above its own level.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const budgets = () => require('../modules/spending/budgets');
const person = (u, role) => ({ ...u.user, role, orgId: u.orgId });

test('a leader sets a member\'s budget in its own slot; the tightest wins; never the owner or a higher level', async () => {
  const levels = require('../modules/auth/levels');
  const lead = levels.create({ name: 'Budget lead', rights: ['read', 'chat', 'delegate'], tools: { allow: ['*'] }, delegates: ['budget'] }, { actorLevel: 'owner' });
  const other = levels.create({ name: 'Grant-only lead', rights: ['read', 'chat', 'delegate'], tools: { allow: ['*'] }, delegates: ['use:model:*'] }, { actorLevel: 'owner' });
  const leader = await H.signIn(lead.id, 'lead-a@test.local');
  const grantor = await H.signIn(other.id, 'lead-b@test.local');
  const member = await H.signIn('member', 'team-a@test.local');
  const admin = await H.signIn('admin', 'admin-a@test.local');
  const owner = { ...H.owner.user, role: 'owner' };

  assert.equal(budgets().leads(person(leader, lead.id), member.user.id), true);
  assert.equal(budgets().leads(person(grantor, other.id), member.user.id), false, 'its delegates do not name budget');
  assert.equal(budgets().leads(person(leader, lead.id), H.owner.user.id), false, 'never the owner');
  assert.equal(budgets().leads(person(leader, lead.id), admin.user.id), false, 'never a level above its own');

  budgets().set(owner, { personId: member.user.id, budget: { tokensPerDay: 50000 } });
  budgets().set(person(leader, lead.id), { personId: member.user.id, budget: { tokensPerDay: 80000, tokensPerMonth: 500000 } });
  const eff = budgets().effective(person(member, 'member'));
  assert.deepEqual(eff.tokensPerDay, { limit: 50000, from: 'admin' }, 'the leader did not loosen the admin\'s');
  assert.deepEqual(eff.tokensPerMonth, { limit: 500000, from: 'leader' }, 'and its own month limit counts');
  assert.throws(() => budgets().set(person(grantor, other.id), { personId: member.user.id, budget: { tokensPerDay: 1 } }), e => e.status === 403);

  const r = await H.api(null, 'GET', '/api/spending', undefined, { Cookie: leader.cookie, 'X-Doca-Password': '' });
  assert.equal(r.status, 200);
  assert.equal(r.body.lead, true);
  assert.ok(r.body.people.some(p => p.id === member.user.id && p.set?.tokensPerMonth === 500000));
  assert.ok(!r.body.people.some(p => p.id === H.owner.user.id), 'the owner is not on a leader\'s team');
});
