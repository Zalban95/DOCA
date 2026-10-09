'use strict';

/**
 * An admin gives a device that belongs to nobody to a person, held to their level (devices-assign.js; the owner's yes,
 * 2026-10-09): never one that is someone's, never by a non-admin, never to a person who keeps no devices.
 */
const H = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

before(() => H.start());
after(() => H.stop());

const call = async (cookie, method, p, body) => {
  const res = await fetch(H.base + p, { method, headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};
const as = who => (m, p, body) => H.api(null, m, p, body, { Cookie: who.cookie, 'X-Doca-Password': '' });
const devices = () => require('../modules/api-v1/devices');

async function auditOf(action) {
  await H.sleep(50);
  return (await require('../modules/auth/store').auditTail(400)).filter(e => e.action === action);
}

test('an admin gives an ownerless device to a person: held to their level, its page opens for them, written down', async () => {
  const { PRESETS } = require('../modules/api-v1/scopes');
  const mia = await H.signIn('member');
  const watch = devices().create({ name: 'Old watch', scopes: PRESETS.phone, caps: { formFactor: 'watch' } }).device;
  assert.equal((await call(mia.cookie, 'GET', `/d/${watch.id}/`)).status, 404, 'nobody\'s page before');
  const dry = await H.api(null, 'POST', `/api/devices/${watch.id}/assign`, { userId: mia.user.id, dryRun: true });
  assert.equal(dry.status, 200, JSON.stringify(dry.body));
  assert.ok(dry.body.dropped.some(s => s.startsWith('command')), 'a member holds no hub commands');
  assert.equal(devices().get(watch.id).userId, undefined, 'a dry run writes nothing');
  const r = await H.api(null, 'POST', `/api/devices/${watch.id}/assign`, { userId: mia.user.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rec = devices().get(watch.id);
  assert.equal(rec.userId, mia.user.id);
  assert.ok(!rec.scopes.some(s => s.startsWith('command')), 'narrowed as approval narrows');
  assert.deepEqual(r.body.dropped, dry.body.dropped);
  assert.equal(require('../modules/api-v1/owner-ceiling').narrow(rec), rec, 'already within her level: nothing more to narrow');
  assert.equal((await call(mia.cookie, 'GET', `/d/${watch.id}/`)).status, 200, 'its own page opens for her now');
  assert.ok((await as(mia)('GET', '/api/devices')).body.devices.some(d => d.id === watch.id), 'listed as hers');
  assert.ok((await auditOf('device assigned')).some(e => e.subjectId === mia.user.id && e.detail.includes(watch.id)));
});

test('assigning refuses a device that already belongs to someone, a non-admin, and a person who keeps no devices', async () => {
  const mia = await H.signIn('member');
  const viewer = await H.signIn('viewer');
  const owned = devices().create({ name: 'Her phone', scopes: ['interact'], caps: { formFactor: 'phone' } }).device;
  devices().update(owned.id, { userId: mia.user.id });
  const moved = await H.api(null, 'POST', `/api/devices/${owned.id}/assign`, { userId: H.owner.user.id });
  assert.equal(moved.status, 409);
  assert.match(moved.body.error, /never moved from one person to another/);
  assert.equal(devices().get(owned.id).userId, mia.user.id);
  const loose = devices().create({ name: 'Loose', scopes: ['interact'], caps: { formFactor: 'phone' } }).device;
  const byMember = await as(mia)('POST', `/api/devices/${loose.id}/assign`, { userId: mia.user.id });
  assert.equal(byMember.status, 403, 'the devices right, not chat');
  const toViewer = await H.api(null, 'POST', `/api/devices/${loose.id}/assign`, { userId: viewer.user.id });
  assert.equal(toViewer.status, 400);
  assert.match(toViewer.body.error, /does not reach devices/);
  assert.equal((await H.api(null, 'POST', '/api/devices/dev_0000/assign', { userId: mia.user.id })).status, 404);
});
