'use strict';

/**
 * A signed-in browser nobody opened for devices.browserArchiveDays goes to the Archive, its sign-in ended, and signing
 * in again from it brings the same record back (screens/archive.js; the owner's yes, 2026-10-09). Nothing but a browser
 * is ever put away by it.
 */
const H = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

before(() => H.start());
after(() => H.stop());

const DAY = 86400e3;
const call = async (cookie, method, p, body) => {
  const res = await fetch(H.base + p, { method, headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};
const as = who => (m, p, body) => H.api(null, m, p, body, { Cookie: who.cookie, 'X-Doca-Password': '' });
const devices = () => require('../modules/api-v1/devices');

test('a browser unseen for a week goes to the Archive, signed out; signing in again from it brings the same record back', async () => {
  const mia = await H.signIn('member');
  const first = await call(mia.cookie, 'GET', '/api/screen');
  assert.equal(first.status, 200);
  const id = first.body.id;
  // A phone of hers and an ownerless watch, both long unseen: never put away by this.
  const phone = devices().create({ name: 'Mia phone', scopes: ['interact'], caps: { formFactor: 'phone' } }).device;
  devices().update(phone.id, { userId: mia.user.id });
  const a = require('../modules/screens/archive');
  const later = Date.now() + 8 * DAY;
  assert.equal(a.sweep(Date.now() + 2 * DAY).filter(d => d.id === id).length, 0, 'two days unseen is not a week');
  const gone = a.sweep(later);
  assert.ok(gone.some(d => d.id === id));
  assert.ok(!gone.some(d => d.id === phone.id), 'a phone is never put away by this');
  assert.ok(devices().get(id).archivedAt);
  assert.ok(!devices().get(phone.id).archivedAt);
  // Out of the Devices list, in the Archive (hers, and the host's).
  const list = await H.api(null, 'GET', '/api/devices');
  assert.ok(!list.body.devices.some(d => d.id === id), 'out of the Devices list');
  const hers = await as(mia)('GET', '/api/archive');
  assert.equal(hers.status, 401, 'her sign-in on that browser ended');
  const host = await H.api(null, 'GET', '/api/archive');
  assert.ok(host.body.items.some(i => i.kind === 'device' && i.id === id));
  // One activity line said so.
  assert.ok(require('../modules/activity').list({ limit: 50 }).some(l => l.from === 'devices' && /put away 1 browser/.test(l.what)));
  // Signing in again from that browser (its doca_screen cookie) brings the same record back.
  const credentials = require('../modules/auth/credentials');
  const again = `${credentials.COOKIE}=${credentials.startSession({ user: mia.user, orgId: mia.orgId })}; ${first.cookie}`;
  const back = await call(again, 'GET', '/api/screen');
  assert.equal(back.status, 200);
  assert.equal(back.body.id, id, 'the same record, not a new one');
  assert.ok(!devices().get(id).archivedAt, 'back from the Archive');
});

test('the Archive restores a browser and puts one away by hand; 0 days never sweeps; only browsers go', async () => {
  const sam = await H.signIn('member');
  const s = await call(sam.cookie, 'GET', '/api/screen');
  const id = s.body.id;
  const put = await H.api(null, 'POST', `/api/archive/device/${id}`, { on: true });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.ok(devices().get(id).archivedAt);
  assert.equal((await call(sam.cookie, 'GET', '/api/screen')).status, 401, 'put away by hand: signed out too');
  const restored = await H.api(null, 'POST', `/api/archive/device/${id}`, { on: false });
  assert.equal(restored.status, 200);
  assert.ok(!devices().get(id).archivedAt);
  const phone = devices().create({ name: 'p', scopes: [], caps: { formFactor: 'phone' } }).device;
  assert.equal((await H.api(null, 'POST', `/api/archive/device/${phone.id}`, { on: true })).status, 404, 'a phone is not a browser');
  const u = require('../modules/utils'); const p = u.loadPrefs(); p.devices = { browserArchiveDays: 0 }; u.savePrefs(p);
  try { assert.deepEqual(require('../modules/screens/archive').sweep(Date.now() + 400 * DAY), [], '0: never'); }
  finally { const q = u.loadPrefs(); delete q.devices; u.savePrefs(q); }
});

test('the setting is the owner\'s: declared, default 7, never proposable', () => {
  const schema = require('../modules/settings-schema');
  assert.equal(schema.value('devices.browserArchiveDays'), 7);
  const settable = require('../modules/harness/settings').SETTABLE;
  assert.ok(Array.isArray(settable) && settable.length);
  assert.ok(!settable.some(x => 'devices.browserArchiveDays' === x || 'devices.browserArchiveDays'.startsWith(`${x}.`) || x === 'devices'), 'not under any proposable prefix');
});
