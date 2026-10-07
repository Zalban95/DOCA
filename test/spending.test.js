'use strict';

/**
 * Spending with permission (CONSTITUTION S12–S14; docs/design/spending.md; TODO P1.6): budgets are off until somebody
 * sets one and refuse a turn at the budget; the owner is bound only by their own; a spending permission is used once or
 * kept, and a person allows only what their level lets them; the agent proposes and never allows; every change asks
 * for the password, and declining does not.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const budgets     = () => require('../modules/spending/budgets');
const permissions = () => require('../modules/spending/permissions');
const ceiling     = () => require('../modules/harness/turn/ceiling');
const memory      = () => require('../modules/harness/memory');
const person = (u, role) => ({ ...u.user, role, orgId: u.orgId });
const without = { 'X-Doca-Password': '' };

/** A conversation of `who` that spent `tokens`, today. */
async function spend(who, tokens, { provider = 'stub', model = 'm' } = {}) {
  const s = memory().createSession('spending test', { activate: false });
  memory().updateSession(s.id, { person: { id: who.user.id, orgId: who.orgId } });
  await require('../modules/harness/usage').summary({ days: 1 });   // the ledger's table, imported
  await require('../modules/db').run('INSERT INTO usage (at, kind, provider, model, session_id, prompt, completion, cached, source) VALUES (?,?,?,?,?,?,?,?,?)',
    [new Date().toISOString(), 'turn', provider, model, s.id, tokens, 0, 0, 'provider']);
  return s.id;
}

test('a budget is off by default: a turn starts and its agent is told nothing about spending', async () => {
  const m = await H.signIn('member', 'sp-plain@test.local');
  const sid = await spend(m, 5000);
  const p = await ceiling().check({ provider: 'x', model: 'y' }, new Date(), { person: person(m, 'member'), sessionId: sid });
  assert.equal(p._spending, undefined, 'no budget, no permission: no line, no prompt cost');
  const r = await H.api(null, 'GET', '/api/spending', undefined, { Cookie: m.cookie, ...without });
  assert.equal(r.status, 200);
  assert.equal(r.body.me.budget, null);
  assert.equal(r.body.me.tokens, 5000, 'the month counts the conversation\'s calls');
});

test('a budget set is enforced at the start of a turn, saying who can raise it', async () => {
  const m = await H.signIn('member', 'sp-limited@test.local');
  const sid = await spend(m, 900);
  let r = await H.api(null, 'POST', '/api/spending/budget', { budget: { tokensPerDay: 1000 } }, { Cookie: m.cookie, 'X-Doca-Password': m.password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = await ceiling().check({}, new Date(), { person: person(m, 'member'), sessionId: sid });
  assert.match(p._spending, /budget 1000 tokens a day \(used 900 tokens\)/);
  assert.match(require('../modules/harness/turn/prompt').liveBlock(p, null), /spending \(.*budget 1000 tokens a day/, 'the agent reads it after the history');
  await spend(m, 200);
  await assert.rejects(ceiling().check({}, new Date(), { person: person(m, 'member'), sessionId: sid }),
    e => e.status === 429 && e.code === 'budget_reached' && /their own/.test(e.message) && /Settings → Spending/.test(e.message));

  // An admin's budget for them counts too, and the tighter one wins.
  r = await H.api(null, 'POST', '/api/spending/budget', { personId: m.user.id, budget: { tokensPerMonth: 50 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(budgets().effective(person(m, 'member')).tokensPerMonth, { limit: 50, from: 'admin' });
  r = await H.api(null, 'POST', '/api/spending/budget', { personId: H.owner.user.id, budget: { tokensPerDay: 1 } }, { Cookie: m.cookie, 'X-Doca-Password': m.password });
  assert.equal(r.status, 403, 'a member does not set someone else\'s budget');
});

test('the owner is bound only by a budget they set themselves', async () => {
  const owner = person(H.owner, 'owner');
  let r = await H.api(null, 'POST', '/api/spending/budget', { levelId: 'owner', budget: { tokensPerDay: 1 } });
  assert.equal(r.status, 200);
  const sid = await spend(H.owner, 10);
  const p = await ceiling().check({}, new Date(), { person: owner, sessionId: sid });
  assert.equal(p._spending, undefined, 'a level\'s budget never lowers the owner\'s limits');
  r = await H.api(null, 'POST', '/api/spending/budget', { budget: { tokensPerDay: 5 } });
  assert.equal(r.status, 200);
  await assert.rejects(ceiling().check({}, new Date(), { person: owner, sessionId: sid }), e => e.code === 'budget_reached');
  await H.api(null, 'POST', '/api/spending/budget', { budget: {} });
  await H.api(null, 'POST', '/api/spending/budget', { levelId: 'owner', budget: {} });
  assert.equal(budgets().effective(owner), null);
});

test('money budgets count with the owner\'s prices, and the prices then ask for the password', async () => {
  const m = await H.signIn('member', 'sp-money@test.local');
  require('../modules/harness/prices').save({ currency: 'EUR', models: { 'paid/model': { input: 10, output: 10 } } });
  const sid = await spend(m, 1e6, { provider: 'paid', model: 'model' });   // 10 EUR
  let r = await H.api(null, 'POST', '/api/harness/usage/prices', { currency: 'EUR', models: {} }, without);
  assert.equal(r.status, 200, 'no money budget yet: the prices are an ordinary setting');
  require('../modules/harness/prices').save({ currency: 'EUR', models: { 'paid/model': { input: 10, output: 10 } } });
  budgets().set(person(m, 'member'), { budget: { moneyPerMonth: 5 } });
  await assert.rejects(ceiling().check({}, new Date(), { person: person(m, 'member'), sessionId: sid }), e => /5\.00 EUR a month/.test(e.message));
  r = await H.api(null, 'POST', '/api/harness/usage/prices', { currency: 'EUR', models: {} }, without);
  assert.equal(r.status, 401, 'with a money budget the prices decide whether a turn starts');
  r = await H.api(null, 'POST', '/api/harness/usage/prices', { currency: 'EUR', models: {} }, { Cookie: m.cookie, 'X-Doca-Password': m.password });
  assert.equal(r.status, 403, 'and they are a host\'s');
  budgets().set(person(m, 'member'), { budget: {} });
});

test('a permission: one-time is used up, permanent is kept within its month, beyond the level is refused', async () => {
  const m = await H.signIn('member', 'sp-permits@test.local');
  const me = person(m, 'member');
  assert.throws(() => permissions().create(me, { on: { kind: 'service', id: 'hi3d.ai' }, upTo: 5 }), e => e.status === 403 && /does not let you/.test(e.message));
  await H.api(null, 'POST', '/api/spending/budget', { levelId: 'member', mayAllow: 10 });
  assert.throws(() => permissions().create(me, { on: { kind: 'service', id: 'hi3d.ai' }, upTo: 20 }), e => e.status === 403 && /up to 10/.test(e.message));

  const once = permissions().create(me, { on: { kind: 'service', id: 'hi3d.ai' }, upTo: 8 });
  assert.equal(permissions().covers(m.user.id, { kind: 'service', id: 'hi3d.ai' }, 9), null, 'not beyond its amount');
  permissions().consume(m.user.id, { kind: 'service', id: 'hi3d.ai' }, 6);
  assert.equal(permissions().list(me).find(p => p.id === once.id).state, 'used');
  assert.equal(permissions().covers(m.user.id, { kind: 'service', id: 'hi3d.ai' }, 1), null, 'a one-time permission is gone once used');

  const kept = permissions().create(person(H.owner, 'owner'), { personId: m.user.id, on: { kind: 'provider', id: '*' }, upTo: 30, permanent: true });
  permissions().consume(m.user.id, { kind: 'provider', id: 'openrouter' }, 10);
  permissions().consume(m.user.id, { kind: 'provider', id: 'openrouter' }, 10);
  assert.equal(permissions().list(me).find(p => p.id === kept.id).state, 'active', 'a permanent permission is kept');
  assert.throws(() => permissions().consume(m.user.id, { kind: 'provider', id: 'openrouter' }, 15), e => e.status === 403, 'not past its month\'s amount');
  const nextMonth = new Date(Date.now() + 32 * 86400000);
  assert.ok(permissions().covers(m.user.id, { kind: 'provider', id: 'x' }, 15, nextMonth), 'a new month, the whole amount again');
  assert.throws(() => require('../modules/spending/pay').charge(me, { kind: 'provider', id: 'x' }, 5), e => e.code === 'no_payment_method');
  assert.throws(() => require('../modules/spending/pay').charge(me, { kind: 'purchase', id: 'x' }, 5), e => e.code === 'not_permitted');
  await H.api(null, 'POST', '/api/spending/budget', { levelId: 'member', mayAllow: '' });
});

test('the agent proposes; its person accepts with the password, and declining needs none', async () => {
  const m = await H.signIn('member', 'sp-agent@test.local');
  const tools = require('../modules/harness/tools');
  assert.ok(require('../modules/agents/registry').NEVER.includes('spend_propose'), 'a mission never asks to spend');
  assert.match(await tools.call('spend_propose', { kind: 'service', id: 'x', up_to: 1, why: 'w' }, [], {}), /^Error: nobody/);
  let out = await tools.call('spend_propose', { kind: 'service', id: 'hi3d.ai', up_to: 4, why: 'a 3D model for the brochure' }, [], { user: person(m, 'member'), sessionId: 's1' });
  const id = out.match(/Proposed \((sp_\w+)\)/)[1];
  assert.equal(permissions().covers(m.user.id, { kind: 'service', id: 'hi3d.ai' }, 1), null, 'a proposal allows nothing');

  const as = { Cookie: m.cookie, 'X-Doca-Password': m.password };
  let r = await H.api(null, 'POST', `/api/spending/permissions/${id}/accept`, { permanent: true }, { Cookie: m.cookie, ...without });
  assert.equal(r.status, 401, 'accepting asks for the password');
  assert.equal(r.body.code, 'password_required');
  r = await H.api(null, 'POST', `/api/spending/permissions/${id}/accept`, {}, as);
  assert.equal(r.status, 403, 'and stays within the level: a member allows nothing by default');
  r = await H.api(null, 'POST', `/api/spending/permissions/${id}/accept`, { permanent: true });
  assert.equal(r.status, 200, 'an admin may');
  assert.equal(r.body.permanent, true, 'made permanent, as asked');
  out = await tools.call('spend_propose', { kind: 'service', id: 'hi3d.ai', up_to: 2, why: 'again' }, [], { user: person(m, 'member') });
  assert.match(out, /^Already allowed/, 'a permission that covers it is said, not asked again');

  out = await tools.call('spend_propose', { kind: 'purchase', id: 'domain', up_to: 12, why: 'a domain' }, [], { user: person(m, 'member') });
  const id2 = out.match(/Proposed \((sp_\w+)\)/)[1];
  r = await H.api(null, 'POST', `/api/spending/permissions/${id2}/decline`, {}, { Cookie: m.cookie, ...without });
  assert.equal(r.status, 200, 'saying no is free');
  assert.equal(r.body.state, 'declined');
  r = await H.api(null, 'DELETE', `/api/spending/permissions/${id}`, undefined, { Cookie: m.cookie, ...without });
  assert.equal(r.status, 401, 'revoking asks for the password too');
  r = await H.api(null, 'DELETE', `/api/spending/permissions/${id}`, undefined, as);
  assert.equal(r.status, 200);

  const { switchOf } = require('../modules/auth/guarded');
  assert.match(switchOf({ method: 'POST', path: '/api/spending/budget', body: {} }), /spending/);
  assert.equal(switchOf({ method: 'GET', path: '/api/spending', body: {} }), null);
});

test('the rules live in the protected keys folder, out of the agent\'s file tools', () => {
  const file = require('../modules/spending/store').file();
  assert.ok(require('../modules/paths').PROTECTED_DIRS.some(d => file.startsWith(d + require('path').sep)));
});
