'use strict';

/**
 * The security review of 2026-10-07, one test per finding: switching versions and bringing a pack in ask for the
 * password; a proposal's Accept is guarded against the live setting, not its stored `from`; the switch password has a
 * rate limit of its own; spend stays its person's after the conversation is deleted; `mayAllow` caps the total; a
 * money budget refuses an unpriced model; side models and the fallback chain keep to the allotment; a refused call
 * takes no checkpoint; an ownerless device marks nothing seen; a style value cannot fetch.
 */
const fs     = require('fs');
const path   = require('path');
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const without = { 'X-Doca-Password': '' };
const person  = (u, role) => ({ ...u.user, role, orgId: u.orgId });
const memory  = () => require('../modules/harness/memory');
const levels  = () => require('../modules/auth/levels');

test('switching versions and bringing a pack in ask for the password', async () => {
  let r = await H.api(null, 'POST', '/api/versions/use', { version: 'v2.200.0' }, without);
  assert.equal(r.status, 401, 'an older version drops every guard at once');
  assert.match(r.body.error, /version/);
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('not a zip')]), 'p.dpack');
  r = await H.api(null, 'POST', '/api/packs/import', form, without);
  assert.equal(r.status, 401, 'a pack can carry a level');
  r = await H.api(null, 'POST', '/api/packs/library/nope/import', {}, without);
  assert.equal(r.status, 401);
  const { switchOf } = require('../modules/auth/guarded');
  assert.equal(switchOf({ method: 'POST', path: '/api/packs/plan', body: {} }), null, 'the dry run asks nothing');
});

test('a proposal is checked against the live setting, not the `from` stored with it', async () => {
  const tools = require('../modules/harness/tools');
  const before = !!require('../modules/utils').loadPrefs().agents?.enabled;
  const out = await tools.call('settings_propose', { reason: 'r', changes: [{ path: 'agents.enabled', value: !before }] }, [], {});
  const id = out.match(/Proposed \((\w+)\)/)[1];
  const store = require('../modules/store');
  const doc = store.readJson('harness/proposals', { proposals: [] });
  for (const c of doc.proposals.find(p => p.id === id).changes) c.from = c.to;   // edited to read as "no change"
  store.writeJson('harness/proposals', doc);
  const r = await H.api(null, 'POST', `/api/harness/proposals/${id}/apply`, {}, without);
  assert.equal(r.status, 401);
  assert.equal(!!require('../modules/utils').loadPrefs().agents?.enabled, before);
});

test('a wrong switch password never locks the account out of signing in', async () => {
  const routes = require('../modules/auth/routes');
  routes._failures.clear();
  const m = await H.signIn('member', 'Lock-Out@Test.local');
  const user = require('../modules/auth/store').userById(m.user.id);
  for (let i = 0; i < 6; i++) await routes.confirmPassword({ auth: { user } }, 'wrong');
  assert.ok(routes._failures.has(`s:${user.id}`));
  assert.ok(![...routes._failures.keys()].some(k => k.startsWith('e:')), 'not the sign-in\'s counter');
  const r = await H.api(null, 'POST', '/api/auth/login', { email: 'lock-out@test.local', password: m.password }, { Cookie: '' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  routes._failures.clear();
});

test('spend is kept on its row: deleting the conversation does not make it nobody\'s', async () => {
  const m = await H.signIn('member', 'sp-delete@test.local');
  const s = memory().createSession('to delete', { activate: false });
  memory().updateSession(s.id, { person: { id: m.user.id, orgId: m.orgId } });
  const usage = require('../modules/harness/usage');
  await usage.summary({ days: 1 });
  usage.record({ kind: 'step', sessionId: s.id, provider: 'stub', model: 'm', usage: { prompt_tokens: 700, completion_tokens: 0 } });
  await H.sleep(200);
  memory().deleteSession(s.id);
  const spent = await require('../modules/spending/spent').of(m.user.id);
  assert.equal(spent.month.tokens, 700);
});

test('mayAllow caps what a person has allowed in all, not each permission', async () => {
  const m = await H.signIn('member', 'sp-total@test.local');
  const me = person(m, 'member'), permissions = require('../modules/spending/permissions');
  await H.api(null, 'POST', '/api/spending/budget', { levelId: 'member', mayAllow: 10 });
  const a = permissions.create(me, { on: { kind: 'service', id: 'a' }, upTo: 6, permanent: true });
  assert.throws(() => permissions.create(me, { on: { kind: 'service', id: 'b' }, upTo: 6 }), e => e.status === 403 && /in all/.test(e.message));
  permissions.create(me, { on: { kind: 'service', id: 'b' }, upTo: 4 });
  permissions.revoke(me, a.id);
  permissions.create(me, { on: { kind: 'service', id: 'c' }, upTo: 6 });
  await H.api(null, 'POST', '/api/spending/budget', { levelId: 'member', mayAllow: '' });
});

test('with a money budget, an unpriced model refuses the turn and leaves the fallback chain', async () => {
  const m = await H.signIn('member', 'sp-unpriced@test.local');
  const me = person(m, 'member'), spending = require('../modules/spending');
  require('../modules/harness/prices').save({ currency: 'EUR', models: { 'paid/model': { input: 1, output: 1 } } });
  const p = { provider: 'paid', model: 'model', fallbackChain: [{ provider: 'free', model: 'x' }, { provider: 'paid', model: 'model' }] };
  assert.equal(spending.priced({ person: me }, p), p, 'no money budget: nothing changes');
  require('../modules/spending/budgets').set(me, { budget: { moneyPerMonth: 5 } });
  assert.deepEqual(spending.priced({ person: me }, p).fallbackChain, [{ provider: 'paid', model: 'model' }]);
  assert.throws(() => spending.priced({ person: me }, { provider: 'free', model: 'x' }),
    e => e.code === 'unpriced_model' && /no price/.test(e.message) && /admin can price it/.test(e.message));
  require('../modules/spending/budgets').set(me, { budget: {} });
});

test('the allotment holds for the fallback chain, the assistant\'s model and the side models', async () => {
  const L = levels().create({ name: 'Narrow', rights: ['read', 'chat'], tools: { allow: ['*'] }, resources: { model: ['cheap/*'] } }, { actorLevel: 'owner' });
  const u = person(await H.signIn(L.id, 'allot-side@test.local'), L.id);
  const allot = require('../modules/auth/allot');
  const n = allot.narrowModel({ provider: 'cheap', model: 'a', fallbackChain: [{ provider: 'big', model: 'b' }, { provider: 'cheap', model: 'c' }] }, u);
  assert.deepEqual(n.fallbackChain, [{ provider: 'cheap', model: 'c' }], 'a hop is a model call too');
  assert.equal(allot.allowsModel(u, { provider: 'big', model: 'b' }), false);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'modules/harness/agent.js'), 'utf8'), /allowsModel\(client\.user, quick\)/, 'assistant mode\'s model too');
  await assert.rejects(require('../modules/harness/turn/transport').ask({ system: 's', user: 'u', provider: 'big', model: 'b', person: u }),
    e => e.status === 403, 'a side model asked for a person is refused when not allotted (the triage then uses its rules)');
  const prefs = require('../modules/utils').loadPrefs();
  require('../modules/utils').savePrefs({ ...prefs, vision: { ...(prefs.vision || {}), provider: 'big', model: 'b' } });
  await assert.rejects(require('../modules/vision').read(Buffer.from(''), 'where?', { how: 'model', person: u }), e => e.status === 403);
});

test('a refused call takes no checkpoint; an allowed one does', async () => {
  const experiments = require('../modules/experiments');
  experiments.setDeveloper(true); experiments.set('riskTiers', true);
  try {
    const root = fs.mkdtempSync(path.join(H.tmp, 'review-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
    const projects = require('../modules/projects/store');
    const p = projects.create({ root, name: 'Review' });
    const s = memory().createSession('review', { activate: false });
    projects.bind(p.id, s.id);
    require('../modules/harness/modes').set(s.id, 'ask');
    const call = { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'shell', arguments: JSON.stringify({ command: 'rm a.txt' }) } }] };
    await require('../modules/harness/turn/tool-calls').runToolCalls({ reply: call, schemas: [], stepDisabled: [], session: s, client: null,
      isMission: false, step: 1, say: () => {}, announced: new Set() });
    assert.equal(require('../modules/projects/checkpoints').list(p).length, 0, 'refused by the mode: nothing written');
    const risk = require('../modules/harness/risk');
    const r = await risk.before('shell', { command: 'rm a.txt' }, { sessionId: s.id, checkpoint: false });
    assert.equal(r.checkpoint, undefined);
    assert.equal(JSON.stringify(r).includes('pending'), false, 'what waits never travels on an event');
    await risk.keep(r);
    assert.match(r.checkpoint, /^cp_/);
  } finally { experiments.set('riskTiers', false); experiments.setDeveloper(false); }
});

test('the info findings: a style value cannot fetch, and the capability map no longer offers full_auto', () => {
  const layout = require('../modules/panel-layout/layout');
  for (const v of ["image-set('//evil.example/x' 1x)", 'image(x)', 'cross-fade(a, b)', 'element(#x)', "'//evil.example/f'"]) {
    const problems = [];
    assert.equal(layout.normalize({ style: { vars: { '--bg': v } } }, problems).style.vars['--bg'], undefined, v);
    assert.equal(problems.length, 1);
  }
  assert.equal(layout.normalize({ style: { vars: { '--bg': '#101010' } } }).style.vars['--bg'], '#101010');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'modules/api-v1/capability-map-host.js'), 'utf8'), /full_auto/);
});
