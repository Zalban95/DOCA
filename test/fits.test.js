'use strict';

/**
 * The readings name the skills and recipes a request's words match, the inventories that change, and — after a turn
 * whose steps all worked — the offer to keep it (turn/fits.js; audit 2026-10-06, TODO B5).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H    = require('./helpers');
const fits = require('../modules/harness/turn/fits');

test.before(() => H.start());
test.after(() => H.stop());

const ALL = new Set(['skill', 'recipe', 'http_fetch', 'computer_login']);

test('a request\'s words bring the skill and the recipe that fit, with how to use each', () => {
  require('../modules/recipes/store').save({ id: 'restart-whisper', title: 'Restart the speech service', description: 'When transcription stops answering, restart the whisper container.', steps: [{ tool: 'shell', args: { command: 'docker restart whisper' } }] });
  const t = fits.likely('build and install the android app on my phone', ALL);
  assert.match(t, /# Likely fits/);
  assert.match(t, /- skill android-app: .* — `skill` read android-app/);
  assert.match(fits.likely('transcription is not answering, restart whisper', ALL), /- recipe restart-whisper: .* — `recipe` run restart-whisper/);
  assert.equal(fits.likely('hello', ALL), '', 'nothing forced on a greeting');
  assert.equal(fits.likely('build the android app', new Set()), '', 'only what the turn holds');
});

test('the inventories are readings; the offer to keep a turn follows three steps that worked', () => {
  assert.match(fits.inventory(ALL), /saved recipe/);
  assert.match(fits.inventory(ALL), /Logins for computer_login: none yet/);
  const ok = [{ role: 'tool', name: 'shell', content: 'done' }, { role: 'tool', name: 'read_file', content: 'x' }, { role: 'tool', name: 'git', content: 'y' }];
  assert.match(fits.keepHint(ok, ALL), /recipe` save_last/);
  assert.equal(fits.keepHint(ok.slice(0, 2), ALL), '');
  assert.equal(fits.keepHint([...ok, { role: 'tool', name: 'shell', content: 'Error: exit 1' }], ALL), '');
  assert.equal(fits.keepHint([...ok, { role: 'tool', name: 'recipe', content: 'ran' }], ALL), '', 'it already was one');
});

test('today gives the agent the person\'s day as the ambient screen has it (TODO B6)', async () => {
  const ambient = require('../modules/ambient');
  const real = ambient.today;
  let asked = null;
  ambient.today = async (p, o) => { asked = o; return { weather: { place: o.place }, calendar: { events: [] }, notices: [] }; };
  try {
    const out = await require('../modules/harness/tools').call('today', { place: 'Bologna' });
    assert.match(out, /"place": "Bologna"/);
    assert.equal(asked.units, 'metric');
  } finally { ambient.today = real; }
});
