'use strict';

/**
 * The harness's defaults keep reaching an install (deep test B, C1): every ⚙ save — Set-up's "Use it for DOCA's agent"
 * included, which sends a provider and a model — wrote every default into the prefs file, the whole system prompt
 * among them, so a later release's better default never arrived and the Orchestrator was handed the frozen copy as
 * "Your owner's instructions".
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('./helpers');
const { loadPrefs } = require('../modules/utils');
const providers = require('../modules/harness/providers');
const old = require('../modules/harness/old-defaults');

before(() => H.start());
after(() => H.stop());

const stored = () => loadPrefs().harness?.config?.doca || {};

test('a save keeps only what differs from today\'s defaults', async () => {
  const r = await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'my-box', model: 'thinker' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(stored()).sort(), ['model', 'provider'], 'no default copied into the file');
  // The ⚙ form posts every field it shows: the defaults among them still are not stored, a changed one is.
  const all = { ...providers.defaultParams(), provider: 'my-box', model: 'thinker', temperature: 0.2 };
  await H.api(null, 'POST', '/api/harness/doca/config', all);
  assert.deepEqual(stored(), { provider: 'my-box', model: 'thinker', temperature: 0.2 });
  assert.equal(require('../modules/harness/catalog').configFor('doca').maxSteps, providers.defaultParams().maxSteps, 'the default still reads');
  // Back to the default is "not set" again.
  await H.api(null, 'POST', '/api/harness/doca/config', { temperature: providers.defaultParams().temperature });
  assert.equal(stored().temperature, undefined);
});

test('the migration lifts stored defaults, today\'s and former ones, and keeps what the owner wrote', () => {
  const former = 'You are the DOCA harness, as it was once shipped.';
  old.FORMER_PROMPTS.add(crypto.createHash('sha256').update(former).digest('hex'));
  const m = require('../modules/migrations');
  const run = doca => m.run({ harness: { config: { doca } } }, m.MIGRATIONS.filter(x => x.id === '2.332-harness-defaults')).prefs.harness.config.doca;
  assert.deepEqual(run({ ...providers.defaultParams(), provider: 'my-box', model: 'm' }), { provider: 'my-box', model: 'm' });
  assert.deepEqual(run({ systemPrompt: `${former}\n`, maxSteps: 12 }), { maxSteps: 12 });
  assert.deepEqual(run({ systemPrompt: 'Always answer in Italian.' }), { systemPrompt: 'Always answer in Italian.' });
});

test('the Orchestrator never reads a shipped prompt as its owner\'s instructions', () => {
  const { ownerInstructions } = require('../modules/harness/turn/orchestrator-prompt');
  assert.equal(ownerInstructions({ coordinatorInstructions: providers.DEFAULT_SYSTEM_PROMPT }), '');
  const former = 'An older shipped prompt.';
  old.FORMER_PROMPTS.add(crypto.createHash('sha256').update(former).digest('hex'));
  assert.equal(ownerInstructions({ coordinatorInstructions: former }), '', 'a former default is not the owner\'s either');
  assert.match(ownerInstructions({ coordinatorInstructions: 'Always answer in Italian.' }), /# Your owner's instructions\nAlways answer in Italian\./);
});
