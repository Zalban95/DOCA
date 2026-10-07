'use strict';

/**
 * Asked instead of refused, at a person's own budget (CONSTITUTION S12; TODO P1.6; spending/over.js): their own turn
 * is asked once whether to go over it for this turn — yes is this turn only and recorded, no or no answer refuses as
 * before; an admin's, a team leader's or a level's budget still refuses unasked, and so do automatic turns and work
 * done on the person's behalf.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const memory  = () => require('../modules/harness/memory');
const ceiling = () => require('../modules/harness/turn/ceiling');
const over    = () => require('../modules/spending/over');
const person = (u, role = 'member') => ({ ...u.user, role, orgId: u.orgId });

/** A conversation of `who` that spent `tokens` today. */
async function spend(who, tokens) {
  const s = memory().createSession('over test', { activate: false });
  memory().updateSession(s.id, { person: { id: who.user.id, orgId: who.orgId } });
  await require('../modules/harness/usage').summary({ days: 1 });
  await require('../modules/db').run('INSERT INTO usage (at, kind, provider, model, session_id, prompt, completion, cached, source) VALUES (?,?,?,?,?,?,?,?,?)',
    [new Date().toISOString(), 'turn', 'stub', 'm', s.id, tokens, 0, 0, 'provider']);
  return s.id;
}
const own = (m, budget) => H.api(null, 'POST', '/api/spending/budget', { budget }, { Cookie: m.cookie, 'X-Doca-Password': m.password });

/** Answer the next budget question as `who` once it is asked. */
function answerNext(decision, who) {
  const agent = require('../modules/harness/agent');
  return new Promise(resolve => {
    const on = evt => {
      if (evt.type !== 'approval' || evt.state !== 'asked' || !evt.budget) return;
      agent.events.off('event', on);
      resolve(evt);
      setImmediate(() => require('../modules/harness/approval-answer').answerAs({ id: evt.id, decision, person: who }));
    };
    agent.events.on('event', on);
  });
}

test('who is asked: the person on their own turn — not work on their behalf, an automatic turn, or someone else\'s conversation', async () => {
  const m = await H.signIn('member', 'over-who@test.local');
  const sid = await spend(m, 0);
  const p = person(m);
  assert.equal(over().askable({ client: { kind: 'dashboard', user: p }, sessionId: sid })?.id, m.user.id);
  assert.equal(over().askable({ client: { kind: 'phone', id: 'dev_x', user: p }, sessionId: sid })?.id, m.user.id, 'a device that can answer prompts');
  assert.equal(over().askable({ client: { kind: 'dashboard', user: { ...p, onBehalf: true } }, sessionId: sid }), null, 'a mission or work chat for them');
  for (const kind of ['agent', 'schedule', 'recipe']) assert.equal(over().askable({ client: { kind, user: p }, sessionId: sid }), null, kind);
  assert.equal(over().askable({ client: { kind: 'dashboard', user: p }, profile: { id: 'scribe', level: 'specialist' }, sessionId: sid }), null, 'a specialist');
  assert.equal(over().askable({ client: { kind: 'dashboard', user: person({ user: H.owner.user, orgId: m.orgId }, 'owner') }, sessionId: sid }), null,
    'a host in someone else\'s conversation spends their budget, which is not the host\'s to step over');
});

test('at their own budget, a yes goes over it for this turn only, recorded; a no refuses', async () => {
  const m = await H.signIn('member', 'over-yes@test.local');
  const sid = await spend(m, 1200);
  assert.equal((await own(m, { tokensPerDay: 1000 })).status, 200);
  let asked = null;
  const ask = async e => { asked = e; return 'once'; };
  const p = await ceiling().check({}, new Date(), { person: person(m), sessionId: sid, ask });
  assert.match(asked.message, /their own/);
  assert.equal(asked.over.what, '1000 tokens a day');
  assert.match(p._spending, /chose to go over it for this turn only/);
  let log = [];
  for (let i = 0; i < 50 && !log.length; i++) {   // the audit is written after the turn goes on
    log = await require('../modules/db').all("SELECT actor_id, detail FROM audit WHERE action = 'spending.over'");
    if (!log.length) await H.sleep(20);
  }
  assert.ok(log.some(r => r.actor_id === m.user.id && r.detail.includes(sid)), 'the yes is recorded');
  // The budget itself is unchanged: the next turn is asked again.
  assert.deepEqual(require('../modules/spending/budgets').effective(person(m)).tokensPerDay, { limit: 1000, from: 'own' });
  await assert.rejects(ceiling().check({}, new Date(), { person: person(m), sessionId: sid, ask: async () => 'deny' }),
    e => e.status === 429 && e.code === 'budget_reached' && /You chose not to go over it/.test(e.message));
  await assert.rejects(ceiling().check({}, new Date(), { person: person(m), sessionId: sid, ask: async () => 'timeout' }), /Nobody answered/);
  await assert.rejects(ceiling().check({}, new Date(), { person: person(m), sessionId: sid }), e => e.code === 'budget_reached' && !/chose/.test(e.message), 'no ask: refused as before');
});

test('an admin\'s budget, or another budget reached as well, still refuses — unasked', async () => {
  const m = await H.signIn('member', 'over-admin@test.local');
  const sid = await spend(m, 1200);
  let asked = 0;
  const ask = async () => { asked++; return 'once'; };
  assert.equal((await H.api(null, 'POST', '/api/spending/budget', { personId: m.user.id, budget: { tokensPerDay: 1000 } })).status, 200);
  await assert.rejects(ceiling().check({}, new Date(), { person: person(m), sessionId: sid, ask }), e => /an admin's/.test(e.message));
  // Their own is tighter, and the admin's is reached too: going over their own would still be over the admin's.
  assert.equal((await own(m, { tokensPerDay: 500 })).status, 200);
  await assert.rejects(ceiling().check({}, new Date(), { person: person(m), sessionId: sid, ask }), e => /an admin's/.test(e.message));
  assert.equal(asked, 0, 'never asked');
  // Raised by the admin, only their own is reached: now they are asked.
  assert.equal((await H.api(null, 'POST', '/api/spending/budget', { personId: m.user.id, budget: { tokensPerDay: 5000 } })).status, 200);
  await ceiling().check({}, new Date(), { person: person(m), sessionId: sid, ask });
  assert.equal(asked, 1);
});

test('a real turn asks on the panel\'s card and waits: no stops it, yes lets it start', async () => {
  const m = await H.signIn('member', 'over-turn@test.local');
  const sid = await spend(m, 1200);
  assert.equal((await own(m, { tokensPerDay: 1000 })).status, 200);
  const agent = require('../modules/harness/agent');
  const client = { name: 'Dashboard console', kind: 'dashboard', user: person(m) };
  let card = answerNext('deny', person(m));
  await assert.rejects(agent.turn({ message: 'hello', sessionId: sid, client }), /You chose not to go over it/);
  const asked = await card;
  assert.equal(asked.forced, true, 'allowed once or denied, never "always"');
  assert.match(asked.summary, /Your budget of 1000 tokens a day is reached .* Go over it for this turn only\?/);
  assert.equal(asked.personId, m.user.id);
  // Someone else may not answer it for them.
  const other = await H.signIn('member', 'over-other@test.local');
  card = answerNext('once', person(m));
  const started = agent.turn({ message: 'hello again', sessionId: sid, client }).catch(e => e);
  const q = await card;
  assert.throws(() => require('../modules/harness/approval-answer').answerAs({ id: q.id, decision: 'once', person: person(other) }), /someone else's turn/);
  const r = await started;
  // Past the budget, the turn goes on to its model — none is chosen here, so that is where it stops.
  assert.doesNotMatch(String(r?.message || ''), /budget/);
});
