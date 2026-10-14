'use strict';

/**
 * What the licence leaves out is said, never shown as there (a core-only run, 2026-10-14: asked in a project's chat to
 * "make a team", the agent said only the Orchestrator could, and that no specialists were enabled; the feature index
 * it reads still called Teams "on by default", and the project page drew "Teams here — none"). Each check runs with
 * the core only and with the full licence the suite runs under.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const H = require('./helpers');   // first: it points the settings at a temporary folder, and trusts the test key
const F = require('./frontend');

const lic = () => require('../modules/license');
const keys = () => require('../modules/license/keys');
const files = () => require('../modules/license/files');

/** Run `fn` with no licence at all, as a fresh install's next start reads it; the suite's licence comes back after. */
async function coreOnly(fn) {
  const was = keys().preloaded.certificate;
  keys().preloaded.certificate = null;
  files().remove(files().LICENCE);
  lic().reload();
  try { return await fn(); } finally {
    files().remove(files().STATE); files().remove(files().GRACE);
    keys().preloaded.certificate = was;
    lic().reload();
  }
}

const ASK = 'Make a team: one improves the page\'s text, another checks the HTML is valid';
const tool = () => require('../modules/harness/toolbox/features').find(t => t.name === 'features');

test.before(() => H.start());
test.after(() => H.stop());

test('the features tool says what the licence leaves out, and how it comes — never "on by default"', async () => {
  await coreOnly(() => {
    for (const said of [tool().run({ id: 'teams' }), tool().run({ find: 'team' })]) {
      const teams = said.split('\n•').find(l => /Teams \(teams\)/.test(l));
      assert.ok(teams, said);
      assert.match(teams, /not in this hive's licence/);
      assert.match(teams, /Settings → System → Licence/);
      assert.doesNotMatch(teams, /on by default|page: /);
    }
    const core = tool().run({ id: 'projects' });
    assert.doesNotMatch(core, /licence/, 'a core feature reads as before');
  });
  const full = tool().run({ id: 'teams' });
  assert.match(full, /on by default/); assert.doesNotMatch(full, /not in this hive's licence/);
});

test('a request that names an unlicensed feature gets one line in the readings; nothing otherwise', async () => {
  const fits = require('../modules/harness/turn/fits');
  const cues = require('../modules/harness/turn/licence-cues');
  await coreOnly(() => {
    const said = fits.block({ message: ASK, schemas: [] });
    assert.match(said, /# Not in this hive's licence/);
    assert.match(said, /- Teams: not in this hive's licence[^\n]*Settings → System → Licence/);
    assert.equal(said.match(/^- /gm).length, 1, 'one line, for the one feature named');
    assert.match(cues.block('send it to a specialist'), /Specialists and missions/);
    assert.equal(cues.block('fix the typo in index.html'), '', 'a request that names nothing costs nothing');
    assert.equal(cues.block('tell my team about it'), '', 'colleagues are not a team of agents');
  });
  assert.equal(cues.block(ASK), '', 'with the licence, nothing is said');
  assert.doesNotMatch(fits.block({ message: ASK, schemas: [] }), /licence/);
});

test('Settings → System → Features marks what the licence leaves out, and names none of its pages', async () => {
  const draw = async () => {
    const data = (await H.api(null, 'GET', '/api/features')).body;
    const el = { innerHTML: '' };
    const ctx = vm.createContext({ document: { getElementById: id => (id === 'features-list' ? el : null) } });
    vm.runInContext(F.source('lib/html.js'), ctx);
    vm.runInContext(F.fn('featuresFilter'), ctx);
    ctx._featuresData = data;
    vm.runInContext('_featuresData = this._featuresData; featuresFilter("teams")', ctx);
    return { html: el.innerHTML, teams: data.features.find(f => f.id === 'teams') };
  };
  const core = await coreOnly(draw);
  assert.equal(core.teams.licensed, false); assert.deepEqual(core.teams.pageLabels, []);
  assert.match(core.html, /not in this licence/);
  const full = await draw();
  assert.equal(full.teams.licensed, true); assert.ok(full.teams.pageLabels.length);
  assert.doesNotMatch(full.html, /not in this licence/);
});
