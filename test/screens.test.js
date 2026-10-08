'use strict';

// A browser is a device (modules/screens, TODO H2.2–H2.3): its own record, its own settings layered over the
// hive's, revocable — and a paired client reads its effective settings from /api/v1.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(() => H.start());
after(() => H.stop());

const call = async (cookie, method, p, body) => {
  const res = await fetch(H.base + p, { method, headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};

test('a signed-in browser becomes a device of kind browser, and stays the same one', async () => {
  const first = await call(H.owner.cookie, 'GET', '/api/screen');
  assert.equal(first.status, 200);
  assert.match(first.cookie, /^doca_screen=dev_/);
  const d = require('../modules/api-v1/devices').get(first.body.id);
  assert.equal(d.kind, 'browser');
  assert.equal(d.userId, H.owner.user.id);
  assert.deepEqual(d.scopes, [], 'it reaches the hub by its sign-in, not by a token');
  const again = await call(`${H.owner.cookie}; ${first.cookie}`, 'GET', '/api/screen');
  assert.equal(again.body.id, first.body.id);
});

test('a screen\'s look is its own; another screen keeps the hive\'s; a key that is not a screen\'s is refused', async () => {
  const u = require('../modules/utils'); const p = u.loadPrefs(); p.theme = 'dracula'; u.savePrefs(p);
  const a = await call(H.owner.cookie, 'GET', '/api/screen');
  assert.equal(a.body.settings.theme, 'dracula');
  assert.equal(a.body.from.theme, 'hive');
  const jarA = `${H.owner.cookie}; ${a.cookie}`;
  const set = await call(jarA, 'POST', '/api/screen/settings', { theme: 'nord', hiddenTabs: ['docker'] });
  assert.equal(set.body.settings.theme, 'nord');
  assert.equal(set.body.from.theme, 'device');
  const other = await H.signIn('admin', 'screens-admin@test.local');
  const b = await call(other.cookie, 'GET', '/api/screen');
  assert.notEqual(b.body.id, a.body.id);
  assert.equal(b.body.settings.theme, 'dracula', 'the other screen still follows the hive');
  assert.equal(u.loadPrefs().theme, 'dracula', 'the hive\'s value is untouched');
  assert.equal((await call(jarA, 'POST', '/api/screen/settings', { paths: { x: 1 } })).status, 400);
  const back = await call(jarA, 'POST', '/api/screen/settings', { theme: null });
  assert.equal(back.body.settings.theme, 'dracula');
});

test('a member changes their own screen, though the hive\'s prefs are not theirs', async () => {
  const member = await H.signIn('member', 'screens-member@test.local');
  assert.equal((await call(member.cookie, 'POST', '/api/prefs', { theme: 'nord' })).status, 403);
  const r = await call(member.cookie, 'POST', '/api/screen/settings', { theme: 'nord' });
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.theme, 'nord');
  // Each look keeps the colours last chosen for it (self-test round two, C9): Classic + Nord survives a trip to Modern.
  const kept = await call(member.cookie, 'POST', '/api/screen/settings', { skin: 'modern', theme: 'daylight', lookThemes: { classic: 'nord', modern: 'daylight' } });
  assert.equal(kept.status, 200);
  assert.deepEqual((await call(member.cookie, 'GET', '/api/screen')).body.settings.lookThemes, { classic: 'nord', modern: 'daylight' });
});

test('revoking a browser signs it out', async () => {
  const s = await H.signIn('member', 'screens-revoke@test.local');
  const me = await call(s.cookie, 'GET', '/api/screen');
  require('../modules/api-v1/devices').revoke(me.body.id);
  assert.equal((await call(s.cookie, 'GET', '/api/screen')).status, 401);
});

test('a paired client reads its own effective settings from /api/v1', async () => {
  const phone = H.mkDevice('phone', 'phone', H.PHONE_CAPS);
  require('../modules/screens').set(phone.device?.id || phone.id, { theme: 'monokai' });
  const r = await H.api(phone.token, 'GET', '/api/v1/settings/effective');
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.theme, 'monokai');
  assert.equal(r.body.from.theme, 'device');
  assert.equal(r.body.from.hiddenTabs, undefined);
});

test('on a device\'s own page its look is that device\'s, and its app reads it back; another\'s device is refused', async () => {
  const devices = require('../modules/api-v1/devices');
  const phone = H.mkDevice('my phone', 'phone', H.PHONE_CAPS);
  devices.update(phone.device.id, { userId: H.owner.user.id });
  const r = await call(H.owner.cookie, 'POST', `/api/screen/settings?device=${phone.device.id}`, { theme: 'gruvbox' });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, phone.device.id);
  assert.equal((await H.api(phone.token, 'GET', '/api/v1/settings/effective')).body.settings.theme, 'gruvbox');
  const stranger = H.mkDevice('not mine', 'phone', H.PHONE_CAPS);
  const member = await H.signIn('member', 'screens-device-member@test.local');
  devices.update(stranger.device.id, { userId: H.owner.user.id });
  assert.equal((await call(member.cookie, 'GET', `/api/screen?device=${stranger.device.id}`)).status, 404);
});

test('a device\'s notifications are saved on its profile, the rest of the profile kept, and the device is told', async () => {
  const devices = require('../modules/api-v1/devices');
  const profiles = require('../modules/api-v1/profiles');
  const phone = H.mkDevice('quiet phone', 'phone', H.PHONE_CAPS);
  devices.update(phone.device.id, { userId: H.owner.user.id });
  const pagesBefore = profiles.get(phone.device.id).pages;
  const r = await call(H.owner.cookie, 'POST', `/api/screen/profile?device=${phone.device.id}`, { prompts: { haptic: false }, quietHours: { from: '22:30', to: '07:00', allowUrgent: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = profiles.get(phone.device.id);
  assert.deepEqual(p.quietHours, { from: '22:30', to: '07:00', allowUrgent: true });
  assert.equal(p.prompts.haptic, false);
  assert.equal(p.prompts.receive, true, 'what was not sent is kept');
  assert.deepEqual(p.pages, pagesBefore, 'the client\'s pages are kept');
  assert.ok(require('../modules/api-v1/bus').drain(phone.device.id, 0).events.some(e => e.type === 'profile.changed'));
  const browser = await call(H.owner.cookie, 'POST', '/api/screen/profile', { prompts: { receive: false } });
  assert.equal(browser.status, 400, 'a browser takes no questions of its own');
});
