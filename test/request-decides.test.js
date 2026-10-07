'use strict';

/**
 * A person's request is the decision; the agent's own initiative is a proposal (CONSTITUTION S1, 2026-10-07; TODO
 * P1.1): on the person's own turn, within their level, a change they asked for is applied at once with a checkpoint
 * to undo it. An automatic turn, a mission, the agent's own idea or a change outside the level stays a proposal.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const tools = () => require('../modules/harness/tools');
const prefs = () => require('../modules/utils').loadPrefs();
const owner = () => ({ ...H.owner.user, role: 'owner' });
const change = (value, extra = {}) => ({ reason: 'they asked', changes: [{ path: 'mcpSettings.callTimeoutMs', value }], ...extra });

test('asked for on their own turn: applied, with a checkpoint to go back to', async () => {
  const before = require('../modules/checkpoints').list().length;
  const out = await tools().call('settings_propose', change(150000, { asked: true }), [], { byPerson: true, user: owner() });
  assert.match(out, /^Applied, as they asked/);
  assert.equal(prefs().mcpSettings.callTimeoutMs, 150000);
  assert.ok(require('../modules/checkpoints').list().length > before, 'the settings before it are a checkpoint');
});

test('the agent\'s own idea, an automatic turn, or outside the person\'s level: a proposal, nothing written', async () => {
  const t = tools();
  assert.match(await t.call('settings_propose', change(160000), [], { byPerson: true, user: owner() }), /^Proposed/, 'not marked asked');
  assert.match(await t.call('settings_propose', change(170000, { asked: true }), [], { byPerson: false, user: owner() }), /^Proposed/, 'not a person\'s turn');
  const member = await H.signIn('member', 'asked-member@test.local');
  assert.match(await t.call('settings_propose', change(180000, { asked: true }), [], { byPerson: true, user: { ...member.user, role: 'member' } }), /^Proposed/, 'outside a member\'s level');
  assert.equal(prefs().mcpSettings.callTimeoutMs, 150000, 'nothing written by any of them');
});
