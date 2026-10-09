'use strict';

/**
 * Members pair their own devices (deep test A #6; the owner's decision of 2026-10-08, S11): a level that reaches
 * own devices lists, pairs, renames, rotates and revokes only its person's, with a phone-sized preset, and such a
 * device is held to its person on /api/v1 (api-v1/owner-ceiling.js). Admins keep everything.
 */
const h = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { PRESETS } = require('../modules/api-v1/scopes');

before(h.start);
after(h.stop);

const as = who => (m, p, body) => h.api(null, m, p, body, { Cookie: who.cookie, 'X-Doca-Password': '' });

/**
 * Pair through the panel as `who`, then complete it as the device would. A member's own device waits for their
 * one tap (devices-approval/, 2026-10-09), given here unless `allow` is false.
 */
async function pairAs(who, body, caps = h.PHONE_CAPS, { allow = true } = {}) {
  const start = await as(who)('POST', '/api/devices/pair', body);
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const done = await h.api(null, 'POST', '/api/v1/devices/pair/complete', { code: start.body.code, caps }, { Cookie: '' });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  if (allow && done.body.approval?.state === 'pending') {
    const ok = await as(who)('POST', `/api/devices/${done.body.device.id}/approve`, {});
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  }
  return { start: start.body, ...done.body };
}

async function auditWith(action, actorId) {
  await h.sleep(50);   // the audit is written without waiting
  return (await require('../modules/auth/store').auditTail(400)).filter(e => e.action === action && e.actorId === actorId);
}

test('a member pairs a phone of their own: theirs, with the phone preset, never whose or what the body says', async () => {
  const mia = await h.signIn('member');
  const forOwner = await as(mia)('POST', '/api/devices/pair', { name: 'x', preset: 'phone', forUser: h.owner.user.id });
  assert.equal(forOwner.status, 403, 'never someone the body names');
  const r = await pairAs(mia, { name: 'Mia phone', preset: 'phone', userId: h.owner.user.id, scopes: ['*'] });
  assert.deepEqual(r.start.scopes.slice().sort(), PRESETS.phone.slice().sort(), 'the preset\'s scopes, not the body\'s list');
  assert.equal(require('../modules/api-v1/devices').get(r.device.id).userId, mia.user.id, 'recorded as hers, not the owner\'s');
  const list = await as(mia)('GET', '/api/devices');
  assert.equal(list.status, 200);
  assert.equal(list.body.own, true);
  assert.deepEqual(Object.keys(list.body.presets).sort(), ['extension', 'phone', 'watch']);
  assert.deepEqual(list.body.devices.map(d => d.id), [r.device.id], 'only her own');
  assert.equal(list.body.devices[0].mine, true);
  assert.ok((await auditWith('device pairing started', mia.user.id)).some(e => /as phone/.test(e.detail) && e.subjectId === mia.user.id));
});

test('a member cannot pick the admin, agent, hub or registry preset, or a scope list', async () => {
  const mia = await h.signIn('member');
  for (const preset of ['admin', 'agent', 'hub', 'registry', 'viewer']) {
    const r = await as(mia)('POST', '/api/devices/pair', { name: 'x', preset });
    assert.equal(r.status, 403, preset);
    assert.equal(r.body.code, 'preset_refused');
  }
  assert.equal((await as(mia)('POST', '/api/devices/pair', { name: 'x', scopes: ['devices:admin'] })).status, 403);
  // Minting a token by hand and granting scopes stay an admin's.
  assert.equal((await as(mia)('POST', '/api/devices', { name: 'x', preset: 'phone' })).status, 403);
});

test('another person\'s device is not there for a member: listing, renaming, rotating, revoking', async () => {
  const mia = await h.signIn('member'), leo = await h.signIn('member');
  const ownerPhone = h.mkDevice('owner-phone', 'phone', h.PHONE_CAPS);
  require('../modules/api-v1/devices').update(ownerPhone.device.id, { userId: h.owner.user.id });
  const leoPhone = await pairAs(leo, { name: 'Leo phone', preset: 'phone' });
  const ids = (await as(mia)('GET', '/api/devices')).body.devices.map(d => d.id);
  assert.ok(!ids.includes(ownerPhone.device.id) && !ids.includes(leoPhone.device.id));
  for (const id of [ownerPhone.device.id, leoPhone.device.id]) {
    assert.equal((await as(mia)('POST', `/api/devices/${id}/rotate`)).status, 404);
    assert.equal((await as(mia)('PATCH', `/api/devices/${id}`, { name: 'mine now' })).status, 404);
    assert.equal((await as(mia)('DELETE', `/api/devices/${id}`)).status, 404);
    assert.equal((await as(mia)('DELETE', `/api/devices/${id}?purge=1`)).status, 404);
    assert.equal((await as(mia)('POST', `/api/devices/${id}/scopes`, { add: ['harness:chat'] })).status, 403, 'granting is an admin\'s');
  }
  assert.equal(require('../modules/api-v1/devices').get(ownerPhone.device.id).revokedAt, null, 'untouched');
});

test('a member renames, rotates and revokes their own, each in the audit with them', async () => {
  const mia = await h.signIn('member');
  const r = await pairAs(mia, { name: 'Mia tablet', preset: 'phone' });
  const ren = await as(mia)('PATCH', `/api/devices/${r.device.id}`, { name: 'Kitchen tablet', scopes: ['*'] });
  assert.equal(ren.status, 200);
  assert.equal(ren.body.device.name, 'Kitchen tablet');
  assert.deepEqual(ren.body.device.scopes.slice().sort(), PRESETS.phone.slice().sort(), 'a rename changes the name only');
  const rot = await as(mia)('POST', `/api/devices/${r.device.id}/rotate`);
  assert.equal(rot.status, 200);
  assert.equal((await h.api(rot.body.token, 'GET', '/api/v1/capabilities')).status, 200, 'the new token works');
  assert.equal((await as(mia)('DELETE', `/api/devices/${r.device.id}`)).status, 200);
  assert.equal((await h.api(rot.body.token, 'GET', '/api/v1/capabilities')).status, 401, 'revoked');
  for (const a of ['device renamed', 'device token rotated', 'device revoked'])
    assert.ok((await auditWith(a, mia.user.id)).some(e => e.detail.startsWith(r.device.id) && e.subjectId === mia.user.id), a);
});

test('a viewer, and a level that reaches only create, cannot pair', async () => {
  const vic = await h.signIn('viewer');
  assert.equal((await as(vic)('POST', '/api/devices/pair', { name: 'x', preset: 'phone' })).status, 403);
  assert.equal((await as(vic)('GET', '/api/devices')).status, 403);
  let level;
  try { level = require('../modules/auth/levels').create({ name: 'Makers', rights: ['read', 'chat'], reach: 'create' }, { actorLevel: 'owner' }); }
  catch (e) { if (e.status === 501) return; throw e; }   // custom levels need SQLite
  const mak = await h.signIn(level.id);
  const r = await as(mak)('POST', '/api/devices/pair', { name: 'x', preset: 'phone' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /does not reach devices/);
});

test('admins keep everything: every device, every preset, and pairing for someone else within their level', async () => {
  const mia = await h.signIn('member');
  const hers = await pairAs(mia, { name: 'Mia watch', preset: 'watch' }, h.WATCH_CAPS);
  const list = await h.api(null, 'GET', '/api/devices');
  assert.equal(list.body.own, false);
  assert.ok(list.body.presets.admin && list.body.presets.agent);
  assert.ok(list.body.devices.some(d => d.id === hers.device.id), 'an admin sees hers');
  assert.equal((await h.api(null, 'POST', '/api/devices/pair', { name: 'agent', preset: 'agent' })).status, 201);
  // For her: a phone-sized preset only, and the device is hers.
  assert.equal((await h.api(null, 'POST', '/api/devices/pair', { name: 'x', preset: 'admin', forUser: mia.user.id })).status, 403);
  const forHer = await h.api(null, 'POST', '/api/devices/pair', { name: 'Mia desk', preset: 'phone', forUser: mia.user.id });
  assert.equal(forHer.status, 201);
  const done = await h.api(null, 'POST', '/api/v1/devices/pair/complete', { code: forHer.body.code, caps: { formFactor: 'desktop' } }, { Cookie: '' });
  assert.equal(require('../modules/api-v1/devices').get(done.body.device.id).userId, mia.user.id);
  assert.ok((await auditWith('device pairing started', h.owner.user.id)).some(e => e.detail.includes(`for ${mia.user.id}`)));
  assert.equal((await h.api(null, 'DELETE', `/api/devices/${hers.device.id}`)).status, 200, 'an admin revokes anyone\'s');
});

test('on /api/v1 a member\'s phone is held to her: no hub commands, only her own devices', async () => {
  const mia = await h.signIn('member');
  const phone = await pairAs(mia, { name: 'Mia phone 2', preset: 'phone' });
  const watch = await pairAs(mia, { name: 'Mia watch 2', preset: 'watch' }, h.WATCH_CAPS);
  const ownerPhone = h.mkDevice('owner-phone-2', 'phone', h.PHONE_CAPS);
  require('../modules/api-v1/devices').update(ownerPhone.device.id, { userId: h.owner.user.id });

  assert.deepEqual((await h.api(phone.token, 'GET', '/api/v1/commands')).body.commands, []);
  assert.equal((await h.api(phone.token, 'POST', '/api/v1/commands/compose.start', {})).status, 403);
  assert.deepEqual((await h.api(phone.token, 'GET', '/api/v1/capabilities')).body.commands || [], []);
  const ids = (await h.api(phone.token, 'GET', '/api/v1/devices')).body.devices.map(d => d.id);
  assert.ok(ids.includes(watch.device.id) && !ids.includes(ownerPhone.device.id));
  for (const [m, p] of [['GET', ''], ['PATCH', ''], ['POST', '/rotate'], ['DELETE', ''], ['GET', '/profile'], ['GET', '/vars']])
    assert.equal((await h.api(phone.token, m, `/api/v1/devices/${ownerPhone.device.id}${p}`, m === 'PATCH' ? { name: 'x' } : undefined)).status, 404, `${m} ${p}`);
  assert.equal((await h.api(phone.token, 'GET', `/api/v1/devices/${watch.device.id}`)).status, 200, 'her own watch');
  // Its stored scopes are the preset's: an admin's level change would lift the ceiling with no re-pairing.
  assert.ok(require('../modules/api-v1/devices').get(phone.device.id).scopes.includes('command:*'));
  // The owner's phone is unchanged.
  assert.ok((await h.api(ownerPhone.token, 'GET', '/api/v1/commands')).body.commands.length > 0);
  assert.ok((await h.api(ownerPhone.token, 'GET', '/api/v1/devices')).body.devices.some(d => d.id === phone.device.id));
});
