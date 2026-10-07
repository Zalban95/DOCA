'use strict';

/**
 * The agent's way to the screens (toolbox/screens.js; TODO B6b, audit aw 8): it lists the screens with the page each
 * shows, sends a page to one — a host's turn to any screen, anyone else's only to their own — and reads a screen's own
 * settings to propose through settings_propose. Never a mission's, never free of the approval gate.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H     = require('./helpers');   // first: it points the settings at a temporary folder
const tools = require('../modules/harness/tools');

let ownerScreen, member, memberScreen;
test.before(async () => {
  await H.start();
  ownerScreen = (await H.api(null, 'GET', '/api/screen')).body.id;
  await H.api(null, 'POST', '/api/presence', { visible: true, page: 'harness', solo: false });
  member = await H.signIn('member', 'screen-tool-member@test.local');
  memberScreen = (await H.api(null, 'GET', '/api/screen', undefined, { Cookie: member.cookie })).body.id;
});
test.after(() => H.stop());

const owner = () => ({ ...H.owner.user, role: 'owner', orgId: H.owner.orgId });
const mem = () => ({ ...member.user, role: 'member', orgId: member.orgId });
const call = (args, user, screen = null) => tools.call('screen', args, [], { user, screen, sessionId: null });

test('list: a host sees every screen with its page; a member only their own', async () => {
  const all = await call({ action: 'list' }, owner(), ownerScreen);
  assert.match(all, new RegExp(`\\(${ownerScreen}\\) — the screen this turn came from: shows Agents → Harness \\(harness\\)`));
  assert.match(all, new RegExp(`\\(${memberScreen}\\) — member's: not heard from lately`));
  const theirs = await call({ action: 'list' }, mem(), memberScreen);
  assert.match(theirs, new RegExp(memberScreen));
  assert.doesNotMatch(theirs, new RegExp(ownerScreen));
  assert.match(await call({ action: 'list' }, null), /^Error: no person on this turn/);
});

test('show: a page to "this" screen or an own one; another person\'s screen is not there for a member', async () => {
  assert.match(await call({ action: 'show', screen: 'this', page: 'workstream', solo: true }, owner(), ownerScreen),
    /^Sent Agents → Workstream \(alone\) to .*: it opens it now/);
  assert.match(await call({ action: 'show', screen: memberScreen, page: 'ambient' }, mem()), /^Sent .*Ambient/);
  assert.match(await call({ action: 'show', screen: ownerScreen, page: 'ambient' }, mem()), /^Error: no screen .* of theirs/);
  assert.match(await call({ action: 'show', page: 'ambient' }, owner()), /did not come from a screen/);
  assert.match(await call({ action: 'show', screen: ownerScreen, page: '../etc' }, owner()), /^Error: which page\? One of: controls/);
  // A page that is the machine itself is not sent to a screen whose person does not hold host.
  assert.match(await call({ action: 'show', screen: memberScreen, page: 'terminal' }, owner()), /an admin's page, and that screen's person is not one/);
});

test('propose: reads that screen\'s own settings and points at settings_propose; it writes nothing', async () => {
  const out = await call({ action: 'propose', screen: 'this' }, owner(), ownerScreen);
  assert.match(out, /call\.silenceMs = 2000/);
  assert.match(out, /settings_propose with screen "this"/);
  assert.equal((await H.api(null, 'GET', '/api/harness/proposals')).body.pending.length, 0);
  assert.match(await call({ action: 'propose', screen: ownerScreen }, mem()), /^Error: no screen/);
});

test('it asks like any call that acts, a mission never holds it, and its kit is the devices\'', () => {
  assert.ok(!require('../modules/harness/approval').FREE.has('screen'));
  assert.ok(require('../modules/agents/registry').NEVER.includes('screen'));
  assert.equal(require('../modules/harness/kits').kitOf('screen'), 'devices');
});
