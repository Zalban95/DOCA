'use strict';

/** The Hugging Face token lives in the protected keys, not the settings file (modules/hf-token.js; audit 2026-10-06). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const H = require('./helpers');

test.before(() => H.start());
test.after(() => H.stop());

test('saving the token writes the keys file, not the prefs; reading it brings it back for whoever uses it', async () => {
  const utils = require('../modules/utils'), paths = require('../modules/paths');
  let r = await H.api(null, 'POST', '/api/models/hf/settings', { cacheDir: '', token: 'hf_secret123' });
  assert.equal(r.status, 200);
  assert.equal(utils.loadPrefs().models?.hf?.token, undefined, 'not in the settings file');
  assert.equal(JSON.parse(fs.readFileSync(paths.HF_KEYS_FILE, 'utf8')).token, 'hf_secret123');
  assert.ok(paths.PROTECTED_FILES.includes(paths.HF_KEYS_FILE), 'the agent cannot read or write it');
  if (process.platform !== 'win32') assert.equal(fs.statSync(paths.HF_KEYS_FILE).mode & 0o777, 0o600);
  assert.equal(utils.loadModelsPrefs().hf.token, 'hf_secret123', 'services and the hf CLI still get it');
  r = await H.api(null, 'GET', '/api/models/hf/settings');
  assert.notEqual(r.body.token, 'hf_secret123', 'masked on the way out');
  await H.api(null, 'POST', '/api/models/hf/settings', { cacheDir: '', token: r.body.token });   // the mask posted back
  assert.equal(require('../modules/hf-token').get(), 'hf_secret123', 'unchanged');
});

test('a token an older settings file holds moves into the keys once, the newer one winning', () => {
  const hf = require('../modules/hf-token'), migrations = require('../modules/migrations');
  hf.set('');
  const { prefs } = migrations.run({ models: { hf: { cacheDir: '/x', token: 'hf_old' } } });
  assert.equal(prefs.models.hf.token, undefined);
  assert.equal(prefs.models.hf.cacheDir, '/x');
  assert.equal(hf.get(), 'hf_old');
  migrations.run({ models: { hf: { token: 'hf_older' } } });
  assert.equal(hf.get(), 'hf_old', 'one already in the keys is kept');
});
