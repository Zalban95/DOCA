'use strict';

/**
 * Finding a setting by the words people use (modules/settings-find; deep test A, 2026-10-08): asked to "switch my theme
 * to light", "turn on manual approval" or "turn on developer mode", the agent searched settings_read and features until
 * it ran out of steps. Now each answers at the first look with where the setting is and the one way to change it — a
 * proposal applied at once, or the person's own switch with their password and where to click — and the header search
 * finds the same rows.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H       = require('./helpers');   // first: it points the settings at a temporary folder
const devices = require('../modules/api-v1/devices');
const tools   = require('../modules/harness/tools');

let screen, member;
test.before(async () => {
  await H.start();
  screen = H.mkDevice('Desk browser', 'phone', H.PHONE_CAPS);
  devices.update(screen.device.id, { userId: H.owner.user.id, orgId: H.owner.orgId });
  member = await H.signIn('member', 'settings-find-member@test.local');
});
test.after(() => H.stop());

const owner = () => ({ ...H.owner.user, role: 'owner' });
const find = () => require('../modules/settings-find');

test('the words people use find the setting, with how it changes', () => {
  const first = q => find().find(q)[0];
  assert.equal(first('switch my theme to light').id, 'theme');
  assert.equal(first('dark mode').id, 'theme');
  assert.equal(first('turn on manual approval').id, 'approval');
  assert.equal(first('turn on developer mode').id, 'developer');
  assert.equal(first('specialists').id, 'specialists');
  assert.equal(first('max tool steps').id, 'agent-model');
  assert.equal(first('wake word').id, 'call');
  assert.equal(first('quiet hours').id, 'quiet-hours');
  const how = Object.fromEntries(find().rows().map(r => [r.id, r.how]));
  assert.deepEqual([how.theme, how.approval, how.developer, how.specialists, how['agent-model']], ['screen', 'password', 'password', 'guarded', 'propose']);
  assert.match(find().describe(first('manual approval')), /Agents → Harness → the Auto \/ Manual switch[\s\S]*with their password — you cannot change it/);
});

test('every row is on a real page, and the machine\'s are not offered to someone without host', () => {
  const { NAV_TABS, SUB } = require('../modules/features/pages').lists();
  for (const r of find().rows()) if (r.page) assert.ok(NAV_TABS.includes(r.page) || SUB.some(s => `settings/${s.id}` === r.page), `${r.id}: no page ${r.page}`);
  assert.ok(find().find('developer mode', { host: false }).every(r => r.id !== 'developer'));
  assert.equal(find().find('theme', { host: false })[0].id, 'theme', 'a person\'s own look is theirs to find');
});

test('settings_read answers "theme", "approval" and "developer" at the first look', async () => {
  const read = filter => tools.call('settings_read', { filter }, [], { user: owner() });
  assert.match(await read('theme'), /Where and how[\s\S]*"daylight" for light[\s\S]*settings_propose \{screen: "this"/);
  const approval = await read('approval');
  assert.match(approval, /Approval mode[\s\S]*Theirs to switch, with their password/);
  assert.doesNotMatch(approval, /^No settings match/);
  assert.match(await read('developer'), /Settings → Developer → the "Developer mode on this install" switch/);
  assert.match(await read('max tool steps'), /harness\.config\.doca\.maxSteps/, 'each word counts, not only the whole filter');
});

test('features names the setting too, on the page it is really on', async () => {
  const out = await tools.call('features', { find: 'manual approval' }, [], { user: owner() });
  assert.match(out, /Approvals \(auto, manual, unattended\)[\s\S]*page: Agents → Harness/);
  assert.match(out, /Settings that match[\s\S]*Auto \/ Manual switch/);
});

test('the person asking for the light theme gets it on their screen at once', async () => {
  const out = await tools.call('settings_propose', { reason: 'asked', screen: 'this', asked: true, changes: [{ path: 'theme', value: 'daylight' }] },
    [], { screen: screen.device.id, user: owner(), byPerson: true, sessionId: null });
  assert.match(out, /Applied, as they asked/);
  assert.equal(require('../modules/screens').layer(screen.device.id).theme, 'daylight');
});

test('the header search finds settings, and a member only their own', async () => {
  const r = await H.api(null, 'GET', '/api/settings/find?q=approval');
  assert.equal(r.status, 200);
  assert.equal(r.body.results[0].id, 'approval');
  assert.equal(r.body.results[0].page, 'harness');
  assert.equal(r.body.results[0].field, '#hc-approval');
  const theme = (await H.api(null, 'GET', '/api/settings/find?q=theme')).body.results[0];
  assert.deepEqual([theme.where, theme.card], ['Settings → General', 'Appearance']);
  const m = await H.api(null, 'GET', '/api/settings/find?q=developer%20mode', undefined, { Cookie: member.cookie });
  assert.equal(m.status, 200);
  assert.ok(!m.body.results.some(x => x.id === 'developer'), 'developer mode is the machine\'s');
});
