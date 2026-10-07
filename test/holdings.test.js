'use strict';

/**
 * What a person holds, and services and devices as allotted kinds (CONSTITUTION S13; TODO P1.10; auth/holdings.js,
 * auth/allot.js, auth/reach.js): a turn whose provider is an inference service on the hub needs that service allotted
 * when a level lists services; another person's device is lent with use:device:<id>, which an own-devices level then
 * reaches; and one read-only route says what a person has — their own, or anyone's for an admin.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

let member, other, theirs;
const person = (u, role) => ({ ...u.user, role });
const tool = (p, name) => require('../modules/auth/permits').tool({ person: p, name, args: {} });

test.before(async () => {
  await H.start();
  member = await H.signIn('member', 'hold-member@test.local');
  other = await H.signIn('member', 'hold-other@test.local');
  const devices = require('../modules/api-v1/devices'), registry = require('../modules/mcp/registry');
  theirs = H.mkDevice('Other laptop', 'phone', H.PHONE_CAPS).device; devices.update(theirs.id, { userId: other.user.id });
  registry.upsert({ id: 'other-laptop', label: 'Other laptop', transport: 'http', url: 'http://100.64.0.7:1/mcp', origin: { kind: 'client', deviceId: theirs.id } });
  const mine = H.mkDevice('Member phone', 'phone', H.PHONE_CAPS).device; devices.update(mine.id, { userId: member.user.id });
});
test.after(() => H.stop());

test('a provider that is the hub\'s vLLM service is the service too: a level listing services narrows it, a grant allots it', async () => {
  const allot = require('../modules/auth/allot'), providers = require('../modules/harness/providers');
  const real = providers.endpoint;
  providers.endpoint = id => (id === 'svc' ? { id, baseUrl: 'http://127.0.0.1:8001/v1', local: true } : id === 'whisperish' ? { id, baseUrl: 'http://127.0.0.1:8000/v1', local: true } : real(id));
  try {
    assert.equal(allot.serviceOf('svc'), 'vllm');
    assert.equal(allot.serviceOf('whisperish'), null, 'only a service that serves chat: port 8000 is whisper\'s, and a hand-run vLLM\'s');
    assert.equal(allot.serviceOf('openai'), null);
    const L = require('../modules/auth/levels').create({ name: 'Cloud only', rights: ['read', 'chat'], tools: { allow: ['*'] }, resources: { service: ['comfyui'] } }, { actorLevel: 'owner' });
    const u = await H.signIn(L.id, 'hold-cloud@test.local');
    const p = person(u, L.id);
    assert.equal(allot.allowsModel(p, { provider: 'svc', model: 'qwen' }), false, 'the level lists services, and not this one');
    assert.equal(allot.allowsModel(person(member, 'member'), { provider: 'svc', model: 'qwen' }), true, 'a level naming no services keeps today\'s rule');
    assert.equal(allot.allowsModel({ ...H.owner.user, role: 'owner' }, { provider: 'svc', model: 'qwen' }), true);
    assert.throws(() => allot.narrowModel({ provider: 'svc', model: 'qwen' }, p), e => e.status === 403);
    require('../modules/auth/grants').create({ subject: { kind: 'user', id: u.user.id }, permission: 'use:service:vllm', by: { kind: 'user', id: H.owner.user.id } });
    assert.equal(allot.allowsModel(p, { provider: 'svc', model: 'qwen' }), true, 'allotted by a grant');
    const h = await require('../modules/auth/holdings').of(p);
    assert.deepEqual(h.resources.service.granted, ['vllm']);
    assert.deepEqual(h.resources.service.level, ['comfyui']);
    assert.deepEqual(h.resources.service.here, ['vllm'], 'the services here a turn can use, that pass');
  } finally { providers.endpoint = real; }
});

test('another person\'s device, lent with use:device:<id>: an own-devices level reaches it; nothing else does', () => {
  const grants = require('../modules/auth/grants');
  const p = person(member, 'member');
  assert.match(tool(p, 'mcp__other-laptop__files_read').why, new RegExp(`someone else's device — an admin can lend it \\(use:device:${theirs.id}`));
  assert.throws(() => grants.create({ subject: { kind: 'user', id: member.user.id }, permission: 'use:gadget:x', by: { kind: 'user', id: H.owner.user.id } }), /use:<model|provider|key|connector|login|computer|service|device>/);
  grants.create({ subject: { kind: 'user', id: member.user.id }, permission: `use:device:${theirs.id}`, by: { kind: 'user', id: H.owner.user.id } });
  assert.equal(tool(p, 'mcp__other-laptop__files_read').allowed, true, 'lent to them');
  // A create level reaches no device at all, lent or its own.
  const L = require('../modules/auth/levels').create({ name: 'Makers', rights: ['read', 'chat'], tools: { allow: ['*'] }, reach: 'create' }, { actorLevel: 'owner' });
  assert.match(tool({ ...member.user, role: L.id }, 'mcp__other-laptop__files_read').why, /beyond Makers's reach \(create\)/);
  // A secret is still handed only to the person's own device (sealed/use.js): a lent device is not theirs.
  assert.throws(() => require('../modules/sealed/use').deviceOf(theirs.id, p, false), /someone else's device/);
});

test('GET /api/auth/holdings: your own; someone else\'s for an admin only; never a secret', async () => {
  const self = await H.api(null, 'GET', '/api/auth/holdings', undefined, { Cookie: member.cookie });
  assert.equal(self.status, 200, JSON.stringify(self.body));
  assert.equal(self.body.person.id, member.user.id);
  assert.equal(self.body.self, true);
  assert.equal(self.body.level.name, 'Member');
  assert.equal(self.body.level.reach, 'own-devices');
  assert.deepEqual(self.body.devices.own.map(d => d.name), ['Member phone']);
  assert.deepEqual(self.body.devices.lent.map(d => d.name), ['Other laptop']);
  assert.equal(self.body.resources.key.rule, 'allotted');
  assert.equal(self.body.resources.model.rule, 'all');
  assert.ok(self.body.grants.some(g => g.permission === `use:device:${theirs.id}`));
  assert.equal(self.body.spending.budget, null);
  assert.equal((await H.api(null, 'GET', `/api/auth/holdings?person=${other.user.id}`, undefined, { Cookie: member.cookie })).status, 403, 'not another\'s');
  const viewed = await H.api(null, 'GET', `/api/auth/holdings?person=${other.user.id}`);
  assert.equal(viewed.status, 200);
  assert.equal(viewed.body.self, false);
  assert.deepEqual(viewed.body.devices.own.map(d => d.name), ['Other laptop']);
  assert.equal((await H.api(null, 'GET', '/api/auth/holdings?person=usr_nobody')).status, 404);
  const owner = await H.api(null, 'GET', '/api/auth/holdings');
  assert.equal(owner.body.resources.key.rule, 'all', 'an admin holds every one');
  assert.equal((await H.api(null, 'GET', '/api/auth/holdings', undefined, { Cookie: '' })).status, 401);
  // A budget an admin set shows, with what was spent.
  await H.api(null, 'POST', '/api/spending/budget', { personId: member.user.id, budget: { tokensPerDay: 5000 } });
  const b = (await H.api(null, 'GET', '/api/auth/holdings', undefined, { Cookie: member.cookie })).body.spending;
  assert.equal(b.budget.tokensPerDay.limit, 5000);
  assert.equal(b.spent.today.tokens, 0);
});
