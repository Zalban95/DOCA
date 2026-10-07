'use strict';

/**
 * A settings proposal for one screen (harness/screen-proposals.js; audit 2026-10-06, TODO C2): the agent proposes how
 * this screen listens, speaks, rests or looks; the card names the screen; Accept writes that screen's own layer and never
 * the prefs file; nothing but the screen keys marked proposable, and not someone else's screen.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H       = require('./helpers');
const devices = require('../modules/api-v1/devices');
const screens = require('../modules/screens');
const tools   = require('../modules/harness/tools');
const { loadPrefs } = require('../modules/utils');

let phone, theirs, member;
test.before(async () => {
  await H.start();
  phone = H.mkDevice('Kitchen tablet', 'phone', H.PHONE_CAPS);
  devices.update(phone.device.id, { userId: H.owner.user.id, orgId: H.owner.orgId });
  member = await H.signIn('member', 'screen-prop-member@test.local');
  theirs = H.mkDevice('Member phone', 'phone', H.PHONE_CAPS);
  devices.update(theirs.device.id, { userId: member.user.id, orgId: member.orgId });
});
test.after(() => H.stop());

const owner = () => ({ ...H.owner.user, role: 'owner' });

test('settings_read shows the turn\'s screen\'s own settings, and a proposal for "this" screen names it', async () => {
  const read = await tools.call('settings_read', { filter: 'call' }, [], { screen: phone.device.id, user: owner() });
  assert.match(read, /This screen's own[\s\S]*call\.silenceMs = 2000 +# How long a pause/);
  const out = await tools.call('settings_propose', { reason: 'It cuts you off', screen: 'this', changes: [{ path: 'call.silenceMs', value: 3200 }] },
    [], { screen: phone.device.id, user: owner(), sessionId: null });
  assert.match(out, /call\.silenceMs: 2000 → 3200/);
  const p = (await H.api(null, 'GET', '/api/harness/proposals')).body.pending.find(x => x.screen);
  assert.deepEqual(p.screen, { id: phone.device.id, name: 'Kitchen tablet' });
  assert.equal(p.changes[0].section, 'This screen: Kitchen tablet');

  const before = JSON.stringify(loadPrefs());
  const r = await H.api(null, 'POST', `/api/harness/proposals/${p.id}/apply`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(JSON.stringify(loadPrefs()), before, 'the prefs file is untouched');
  assert.equal(screens.layer(phone.device.id).call.silenceMs, 3200, 'the screen\'s own layer holds it');
});

test('only the keys a screen may be proposed, and never someone else\'s screen or a secret', async () => {
  const propose = (changes, screen, user = owner()) => tools.call('settings_propose', { reason: 'r', screen, changes }, [], { screen: phone.device.id, user });
  assert.match(await propose([{ path: 'theme', value: 'dark' }], 'this'), /not something the agent may propose for a screen \(it may: voice, call, ambient, face\)/);
  assert.match(await propose([{ path: 'voice.apiKey', value: 'x' }], 'this'), /holds a secret/);
  assert.match(await propose([{ path: 'call.silenceMs', value: 'long' }], 'this'), /is a number, not a string/);
  const memberPerson = { ...member.user, role: 'member' };
  assert.match(await propose([{ path: 'ambient.place', value: 'Rome' }], phone.device.id, memberPerson), /someone else's/);
  assert.match(await tools.call('settings_propose', { reason: 'r', screen: 'this', changes: [{ path: 'call.silenceMs', value: 900 }] }, [], { user: owner() }),
    /did not come from a screen; name one/);
});

test('a hive proposal is unchanged: it writes the prefs file', async () => {
  const p = require('../modules/harness/settings').propose({ changes: [{ path: 'mcpSettings.callTimeoutMs', value: 90000 }], reason: 'r' });
  assert.equal(p.screen, undefined);
  assert.equal((await H.api(null, 'POST', `/api/harness/proposals/${p.id}/apply`, {})).status, 200);
  assert.equal(loadPrefs().mcpSettings.callTimeoutMs, 90000);
});
