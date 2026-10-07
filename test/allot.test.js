'use strict';

/**
 * Resources are allocated (CONSTITUTION S13; TODO P1.10; auth/allot.js): a level lists the models, providers, keys,
 * accounts and computers its people's agents may use, a grant use:<kind>:<id> allots one past it, a level that names
 * nothing keeps today's rule, and a team leader gives only what their level's `delegates` names.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const allot  = () => require('../modules/auth/allot');
const levels = () => require('../modules/auth/levels');
const grants = () => require('../modules/auth/grants');
const person = (u, role) => ({ ...u.user, role });

test('a level with nothing listed keeps today\'s rule: models for everyone, keys and accounts for admins', async () => {
  const m = await H.signIn('member', 'allot-plain@test.local');
  assert.equal(allot().uses(person(m, 'member'), 'model', 'deepseek/deepseek-chat'), true);
  assert.equal(allot().uses(person(m, 'member'), 'key', 'weather'), false);
  assert.equal(allot().uses(person(m, 'member'), 'key', 'weather', { opened: true }), true, 'a key opened to everyone');
  assert.equal(allot().uses({ ...H.owner.user, role: 'owner' }, 'key', 'weather'), true, 'an admin uses every one');
  assert.equal(allot().uses(null, 'key', 'weather'), true, 'no person on the turn is not narrowed');
});

test('a level lists its models: a turn moves to the first allotted one down the order, or is refused', async () => {
  const L = levels().create({ name: 'Interns', rights: ['read', 'chat'], tools: { allow: ['*'] }, resources: { model: ['cheap/*'] } }, { actorLevel: 'owner' });
  assert.deepEqual(L.resources, { model: ['cheap/*'] });
  const u = await H.signIn(L.id, 'allot-intern@test.local');
  const p = { provider: 'big', model: 'strong', fallbackChain: [{ provider: 'cheap', model: 'small' }] };
  const n = allot().narrowModel(p, person(u, L.id));
  assert.deepEqual([n.provider, n.model], ['cheap', 'small']);
  assert.match(n._allotted, /not allotted/);
  assert.throws(() => allot().narrowModel({ provider: 'big', model: 'strong' }, person(u, L.id)), e => e.status === 403 && /Settings → Users/.test(e.message));
  assert.equal(allot().narrowModel(p, { ...H.owner.user, role: 'owner' }), p, 'an admin is not narrowed');

  grants().create({ subject: { kind: 'user', id: u.user.id }, permission: 'use:model:big/strong', by: { kind: 'user', id: H.owner.user.id } });
  assert.equal(allot().narrowModel(p, person(u, L.id)), p, 'a grant allots one past the level');
});

test('a key, an account and a computer are allotted by grant; covers() reads use: patterns', async () => {
  const m = await H.signIn('member', 'allot-grant@test.local');
  grants().create({ subject: { kind: 'user', id: m.user.id }, permission: 'use:key:weather', by: { kind: 'user', id: H.owner.user.id } });
  assert.equal(allot().uses(person(m, 'member'), 'key', 'weather'), true);
  assert.equal(allot().uses(person(m, 'member'), 'key', 'bank'), false);
  assert.equal(grants().covers('use:model:deepseek/*', 'use:model:deepseek/deepseek-chat'), true);
  assert.equal(grants().covers('use:*:*', 'use:key:x'), true);
  assert.equal(grants().covers('use:key:a', 'use:key:b'), false);

  const L = levels().create({ name: 'Lab', rights: ['read', 'chat'], tools: { allow: ['*'] }, resources: { computer: ['pc1'] } }, { actorLevel: 'owner' });
  const u = await H.signIn(L.id, 'allot-lab@test.local');
  const permits = require('../modules/auth/permits');
  assert.equal(permits.tool({ person: person(u, L.id), name: 'mcp__computer-pc1__shell', args: {} }).allowed, true);
  const no = permits.tool({ person: person(u, L.id), name: 'mcp__computer-pc2__shell', args: {} });
  assert.equal(no.allowed, false);
  assert.match(no.why, /computer pc2/);
});

test('a team leader gives only what their level\'s delegates names', async () => {
  const lead = levels().create({ name: 'Team leader', rights: ['read', 'chat', 'delegate'], tools: { allow: ['*'] }, delegates: ['use:model:*'] }, { actorLevel: 'owner' });
  const leader = await H.signIn(lead.id, 'allot-lead@test.local');
  const member = await H.signIn('member', 'allot-team@test.local');
  const { mayGrant } = require('../modules/auth/permits');
  assert.equal(mayGrant({ giver: person(leader, lead.id), subject: { kind: 'user', id: member.user.id }, permission: 'use:model:cheap/small' }), null);
  assert.match(mayGrant({ giver: person(leader, lead.id), subject: { kind: 'user', id: member.user.id }, permission: 'tool:shell' }) || '', /may give only use:model:\*/);
});
