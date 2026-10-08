'use strict';

// Undoing a settings checkpoint puts back only the leaves its save changed (deep test A, c B4): restoring a change of
// the theme and the temperature put the whole file back, and with it a model chosen since was gone.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');   // first: it points the settings at a temporary folder

before(() => H.start());
after(() => H.stop());

const u = () => require('../modules/utils');

test('a restore puts back only that change\'s leaves, says which, and lists them first', async () => {
  const base = u().loadPrefs();
  u().savePrefs({ ...base, theme: 'dark', harness: { config: { doca: { provider: 'p1', model: 'm1', temperature: 0.7 } } } });
  // The change to undo: the theme and the temperature.
  const p = u().loadPrefs();
  u().savePrefs({ ...p, theme: 'light', harness: { config: { doca: { ...p.harness.config.doca, temperature: 0.3 } } } });
  const undo = (await H.api(null, 'GET', '/api/settings/checkpoints')).body.checkpoints[0];
  assert.deepEqual(undo.leaves, ['harness.config.doca.temperature', 'theme']);
  // Later, a model is chosen.
  const q = u().loadPrefs();
  u().savePrefs({ ...q, harness: { config: { doca: { ...q.harness.config.doca, model: 'm2' } } } });

  const r = await H.api(null, 'POST', `/api/settings/checkpoints/${undo.id}/restore`, {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.leaves, ['harness.config.doca.temperature', 'theme']);
  const now = u().loadPrefs();
  assert.equal(now.theme, 'dark');
  assert.equal(now.harness.config.doca.temperature, 0.7);
  assert.equal(now.harness.config.doca.model, 'm2', 'the model chosen since stays');
  assert.equal(now.harness.config.doca.provider, 'p1');
});

test('a leaf the change added is removed again; a checkpoint kept before leaves were recorded works them out', async () => {
  const cp = require('../modules/checkpoints');
  const p = u().loadPrefs();
  u().savePrefs({ ...p, ambient: { ...(p.ambient || {}), margin: 9 } });
  const added = cp.list()[0];
  assert.deepEqual(added.leaves, ['ambient.margin']);
  // As an older checkpoint: no `leaves` in its file.
  const dir = path.join(require('../modules/store').DATA_DIR, 'checkpoints', 'prefs');
  const file = path.join(dir, `${added.id}.json`);
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete c.leaves;
  fs.writeFileSync(file, JSON.stringify(c));
  assert.deepEqual(cp.list()[0].leaves, ['ambient.margin'], 'worked out against today\'s settings');
  const r = cp.restore(added.id);
  assert.deepEqual(r.leaves, ['ambient.margin']);
  assert.equal(u().loadPrefs().ambient?.margin, undefined);
  assert.throws(() => cp.restore('../../etc'), /No such checkpoint/);
});
