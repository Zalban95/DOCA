'use strict';

// Set-up offers a mastermind and a worker per budget (guided/pairs.js): from a versioned table, only from providers
// whose key is here, checked against the provider's own /models list before anything is saved — and the route writes
// nothing (the panel saves the two settings through POST /api/prefs).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

before(() => H.start());
after(() => H.stop());

const pairs = () => require('../modules/guided/pairs');
const doc = () => require('../modules/guided/suggestions').load();
const keyed = [{ id: 'openrouter', label: 'OpenRouter', hasKey: true }];
const listed = ids => async () => ({ models: ids, error: null });

test('the shipped table is versioned, sourced and dated, and every entry names a provider and a model', () => {
  const t = require('../modules/guided/suggested-models.json').pairs;
  assert.ok(Number.isInteger(t.version) && /^\d{4}-\d\d-\d\d$/.test(t.checked) && /Artificial Analysis/.test(t.source));
  assert.deepEqual(t.budgets.map(b => b.id), ['value', 'strength']);
  for (const b of t.budgets) for (const r of ['mastermind', 'worker']) {
    assert.ok(b[r].length, `${b.id} has a ${r}`);
    for (const e of b[r]) assert.ok(e.provider && e.model && e.name && Number.isFinite(e.index), `${b.id}/${r}: ${e.name}`);
  }
});

test('a pair is offered only from a provider with a key here; without one, where the key goes', () => {
  const none = pairs().offer(doc(), [{ id: 'openrouter', label: 'OpenRouter', hasKey: false }]);
  assert.ok(none.budgets.every(b => !b.ready && b.missing.some(m => m.id === 'openrouter' && /openrouter\.ai/.test(m.keyPage))));
  const o = pairs().offer(doc(), keyed);
  const value = o.budgets.find(b => b.id === 'value');
  assert.equal(value.ready, true);
  assert.equal(value.mastermind.name, 'GPT-6.1 Sol');
  assert.equal(value.worker.name, 'DeepSeek V4.1 Flash');
  assert.equal(o.budgets.find(b => b.id === 'strength').mastermind.name, 'Gemini 4 Argon');
  assert.equal(value.chosen, false);
});

test('applying checks both models against the provider\'s list: present gives the two values, absent refuses with the list', async () => {
  const all = ['openai/gpt-6.1-sol', 'deepseek/deepseek-v4.1-flash', 'google/gemini-4-argon'];
  const ok = await pairs().check(doc(), 'value', { providers: keyed, models: listed(all) });
  assert.deepEqual(ok.values, { mastermind: 'openrouter/openai/gpt-6.1-sol', worker: 'openrouter/deepseek/deepseek-v4.1-flash' });
  assert.equal(require('../modules/harness/turn/model-route').parse(ok.values.mastermind).provider, 'openrouter', 'the provider is before the first slash');
  await assert.rejects(pairs().check(doc(), 'value', { providers: keyed, models: listed(['openai/gpt-5.6-sol', 'deepseek/deepseek-v4.1-flash']) }),
    e => e.status === 409 && e.code === 'not_offered' && /GPT-6\.1 Sol .*not in openrouter's model list.*openai\/gpt-5\.6-sol/.test(e.message) && e.available.length === 2);
  await assert.rejects(pairs().check(doc(), 'nope', { providers: keyed, models: listed(all) }), e => e.status === 400);
  await assert.rejects(pairs().check(doc(), 'value', { providers: [], models: listed(all) }), e => e.code === 'no_key' && /Field → API keys/.test(e.message));
});

test('Set-up lists the pairs, and the check route writes nothing', async () => {
  const before = require('../modules/utils').loadPrefs().harness?.models;
  const g = await H.api(null, 'GET', '/api/guided');
  assert.equal(g.status, 200);
  assert.deepEqual(g.body.pairs.budgets.map(b => b.id), ['value', 'strength']);
  const r = await H.api(null, 'POST', '/api/guided/pairs/check', { budget: 'value' });
  assert.equal(r.status, 409, 'no OpenRouter key on a test hub');
  assert.equal(r.body.code, 'no_key');
  assert.deepEqual(require('../modules/utils').loadPrefs().harness?.models, before);
});
