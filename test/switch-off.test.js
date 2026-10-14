'use strict';

// A refusal because a switch is off says which, and how it is switched on (modules/switch-off.js; asked 2026-10-13):
// the first missing switch first, then the next, then what must be set up rather than switched.

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

test.before(() => H.start());
test.after(() => H.stop());

test('the Library, from nothing: developer mode, then the experiment, then its model — each said with its switch', async () => {
  const E = require('../modules/experiments');
  E.setDeveloper(false); require('../modules/utils').savePrefs({ ...require('../modules/utils').loadPrefs(), experiments: {} });
  let r = await H.api(null, 'POST', '/api/library/run', {});
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'switch_off');
  assert.deepEqual([r.body.needs.what, r.body.needs.route, r.body.needs.password, r.body.needs.notice, r.body.needs.mayChange], ['Developer mode', '/api/experiments/developer', false, true, true]);
  assert.equal((await H.api(null, 'POST', r.body.needs.route, r.body.needs.body)).status, 200);
  r = await H.api(null, 'POST', '/api/library/run', {});
  assert.deepEqual([r.body.needs.what, r.body.needs.route], ['The Library', '/api/experiments/library']);
  assert.equal((await H.api(null, 'POST', r.body.needs.route, r.body.needs.body)).status, 200);
  r = await H.api(null, 'POST', '/api/library/run', {});
  assert.equal(r.body.needs.route, null, 'a model is set up, not switched: its page alone');
  assert.equal(r.body.needs.page, 'models');
});

test('someone who may not switch it is told so, and given no switch', async () => {
  const member = await H.signIn('member');
  require('../modules/experiments').setDeveloper(false);
  const r = await H.api(null, 'GET', '/api/library/search?q=boat', undefined, { Cookie: member.cookie });
  assert.equal(r.body.code, 'switch_off');
  assert.equal(r.body.needs.mayChange, false, 'a member is told, and offered no switch');
});

test('specialists off is a question with its own switch', async () => {
  require('../modules/agents/registry').setEnabled?.(false);
  const prefs = require('../modules/utils').loadPrefs();
  require('../modules/utils').savePrefs({ ...prefs, agents: { ...(prefs.agents || {}), enabled: false } });
  const r = await H.api(null, 'POST', '/api/harness/missions', { agentId: 'tester', task: 'look' });
  assert.equal(r.status, 409);
  assert.deepEqual([r.body.code, r.body.needs.route, r.body.needs.body], ['switch_off', '/api/harness/agents/enable', { enabled: true }]);
});

test('connecting one\'s own account before the hive has its OAuth app: set up by an admin, and a member is told so', async () => {
  const member = await H.signIn('member');
  const r = await H.api(null, 'POST', '/api/accounts/connect', { provider: 'google' }, { Cookie: member.cookie });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'switch_off');
  assert.deepEqual([r.body.needs.route, r.body.needs.page, r.body.needs.mayChange], [null, 'connectors', false]);
  const owner = await H.api(null, 'POST', '/api/accounts/connect', { provider: 'google' });
  assert.equal(owner.body.needs?.mayChange, true, 'an admin is offered Set it up');
});

test('what is not set up yet is a question with its page and card (R13a, 2026-10-13)', async () => {
  const { loadPrefs, savePrefs } = require('../modules/utils');
  savePrefs({ ...loadPrefs(), channels: {} });
  const cases = [
    [() => require('../modules/retrieval/embed').embed(['x'], { model: '' }), 'settings/harness', 'Retrieval'],
    [() => require('../modules/channels/telegram/api').call('getMe'), 'settings/channels', 'Telegram'],
  ];
  for (const [fn, page, card] of cases) {
    let e = null;
    try { await fn(); } catch (x) { e = x; }
    assert.ok(e, page);
    assert.equal(e.code, 'switch_off', e.message);
    assert.deepEqual([e.needs.page, e.needs.card, e.needs.route], [page, card, null], 'set up, not switched: no route to call');
  }
  const body = require('../modules/switch-off').body(await require('../modules/retrieval/embed').embed(['x'], { model: '' }).catch(e => e), { auth: { role: 'owner' } });
  assert.equal(body.needs.mayChange, true, 'the answer carries what the panel needs to ask');
});
