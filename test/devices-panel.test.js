'use strict';

/**
 * Dashboard-side device management (/api/devices).
 *
 * These routes sit on the legacy, unauthenticated browser surface on purpose,
 * so the two things worth locking down are: the tokens they mint are real and
 * correctly scoped, and DOCA_LEGACY_TRUST=0 actually turns minting off.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');

before(h.start);
after(h.stop);

const trustOff = async fn => {
  const prev = process.env.DOCA_LEGACY_TRUST;
  process.env.DOCA_LEGACY_TRUST = '0';
  try { await fn(); } finally {
    if (prev === undefined) delete process.env.DOCA_LEGACY_TRUST;
    else process.env.DOCA_LEGACY_TRUST = prev;
  }
};

test('the registry lists devices and the vocabulary the UI needs, without a token', async () => {
  const r = await h.api(null, 'GET', '/api/devices');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.devices));
  assert.ok(r.body.presets.phone && r.body.presets.watch, 'presets are exposed for the form');
  assert.ok(r.body.families.read, 'scope families are exposed for the form');
  assert.equal(r.body.trusted, true);
  // No secret material may appear in a listing on an unauthenticated route.
  assert.equal(JSON.stringify(r.body).includes('tokenHash'), false);
});

test('issuing mints a working, correctly scoped token', async () => {
  const r = await h.api(null, 'POST', '/api/devices', { name: 'panel-phone', preset: 'phone' });
  assert.equal(r.status, 201);
  assert.match(r.body.token, /^doca_dev_[0-9a-f]+\./);
  assert.ok(r.body.device.scopes.includes('devices:admin'), 'phone preset can enrol other devices');

  // The token must actually authenticate against the real API.
  const caps = await h.api(r.body.token, 'GET', '/api/v1/capabilities');
  assert.equal(caps.status, 200);
  assert.equal(caps.body.device.name, 'panel-phone');

  const list = await h.api(null, 'GET', '/api/devices');
  assert.ok(list.body.devices.some(d => d.id === r.body.device.id));
});

test('issuing validates its input', async () => {
  const noName = await h.api(null, 'POST', '/api/devices', { preset: 'watch' });
  assert.equal(noName.status, 400);
  assert.equal(noName.body.error, 'name_required');

  const noScopes = await h.api(null, 'POST', '/api/devices', { name: 'x', preset: 'nope' });
  assert.equal(noScopes.status, 400);
  assert.equal(noScopes.body.error, 'scopes_required');
});

test('an explicit scope list is honoured over presets', async () => {
  const r = await h.api(null, 'POST', '/api/devices', { name: 'narrow', scopes: ['read:system.cpu'] });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.device.scopes, ['read:system.cpu']);
});

test('pairing hands out a short-lived code and a QR, never a token', async () => {
  const r = await h.api(null, 'POST', '/api/devices/pair', { name: "Al's watch", preset: 'watch' });
  assert.equal(r.status, 201);
  assert.match(r.body.code, /^\d{3}-\d{3}$/);
  assert.match(r.body.url, /^doca:\/\/pair\?code=\d{6}&host=/);
  assert.ok(r.body.qr.startsWith('<svg'), 'a scannable QR is returned');
  assert.equal(r.body.token, undefined, 'the panel never sees the device token');
  assert.ok(Date.parse(r.body.expiresAt) > Date.now());

  // The device completes pairing itself and gets the preset's scopes.
  const done = await h.api(null, 'POST', '/api/v1/devices/pair/complete',
    { code: r.body.code, caps: h.WATCH_CAPS });
  assert.equal(done.status, 201);
  assert.match(done.body.token, /^doca_dev_/);
  assert.ok(done.body.device.scopes.includes('interact'));
  assert.equal(done.body.device.scopes.includes('devices:admin'), false, 'a watch cannot enrol devices');

  const caps = await h.api(done.body.token, 'GET', '/api/v1/capabilities');
  assert.equal(caps.status, 200);
  assert.equal(caps.body.device.caps.formFactor, 'watch');
});

test('a pairing code is single use', async () => {
  const r = await h.api(null, 'POST', '/api/devices/pair', { name: 'once', preset: 'viewer' });
  const a = await h.api(null, 'POST', '/api/v1/devices/pair/complete', { code: r.body.code, caps: {} });
  assert.equal(a.status, 201);
  const b = await h.api(null, 'POST', '/api/v1/devices/pair/complete', { code: r.body.code, caps: {} });
  assert.equal(b.status, 400);
});

test('rotate issues a replacement and revoke kills the token', async () => {
  const created = await h.api(null, 'POST', '/api/devices', { name: 'rotate-me', preset: 'viewer' });
  const id = created.body.device.id;

  const rot = await h.api(null, 'POST', `/api/devices/${id}/rotate`);
  assert.equal(rot.status, 200);
  assert.notEqual(rot.body.token, created.body.token);
  assert.equal((await h.api(rot.body.token, 'GET', '/api/v1/capabilities')).status, 200);

  const del = await h.api(null, 'DELETE', `/api/devices/${id}`);
  assert.equal(del.status, 200);
  assert.equal((await h.api(rot.body.token, 'GET', '/api/v1/capabilities')).status, 401);

  assert.equal((await h.api(null, 'POST', '/api/devices/dev_deadbeef/rotate')).status, 404);
  assert.equal((await h.api(null, 'DELETE', '/api/devices/dev_deadbeef')).status, 404);
});

test('revoking keeps the row, forgetting removes it along with the profile', async () => {
  const created = await h.api(null, 'POST', '/api/devices', { name: 'forget-me', preset: 'watch' });
  const id = created.body.device.id;
  const token = created.body.token;

  // Something kept under the id, so the cleanup has work to do.
  assert.equal((await h.api(token, 'PUT', `/api/v1/devices/me/profile`,
    { pages: [{ id: 'home', surfaces: [{ id: 'system.cpu' }] }] })).status, 200);

  await h.api(null, 'DELETE', `/api/devices/${id}`);
  const afterRevoke = await h.api(null, 'GET', '/api/devices');
  const row = afterRevoke.body.devices.find(d => d.id === id);
  assert.ok(row, 'a revoked device stays listed: the row is the audit trail');
  assert.ok(row.revokedAt, 'and it says when');

  const purge = await h.api(null, 'DELETE', `/api/devices/${id}?purge=1`);
  assert.equal(purge.status, 200);
  assert.equal(purge.body.purged, true);

  const afterForget = await h.api(null, 'GET', '/api/devices');
  assert.equal(afterForget.body.devices.some(d => d.id === id), false, 'the row is gone');

  // The profile went with it rather than being left orphaned under an id that can
  // never authenticate again — which is what `remove()` alone used to do.
  const profile = require('../modules/api-v1/profiles');
  assert.deepEqual(profile.get(id).pages, profile.DEFAULT_PROFILE.pages, 'back to the default, i.e. no stored file');

  assert.equal((await h.api(null, 'DELETE', '/api/devices/dev_deadbeef?purge=1')).status, 404);
});

test('DOCA_LEGACY_TRUST=0 disables minting but still allows the read-only listing', async () => {
  const victim = await h.api(null, 'POST', '/api/devices', { name: 'pre-existing', preset: 'viewer' });
  const id = victim.body.device.id;

  await trustOff(async () => {
    const listed = await h.api(null, 'GET', '/api/devices');
    assert.equal(listed.status, 200, 'the UI can still explain itself');
    assert.equal(listed.body.trusted, false);

    for (const [method, path, body] of [
      ['POST',   '/api/devices',                 { name: 'nope', preset: 'admin' }],
      ['POST',   '/api/devices/pair',            { name: 'nope', preset: 'watch' }],
      ['POST',   `/api/devices/${id}/rotate`,    undefined],
      ['DELETE', `/api/devices/${id}`,           undefined],
    ]) {
      const r = await h.api(null, method, path, body);
      assert.equal(r.status, 403, `${method} ${path} must be refused`);
      assert.equal(r.body.error, 'legacy_trust_disabled');
    }
  });

  // The pre-existing token is untouched by the switch.
  assert.equal((await h.api(victim.body.token, 'GET', '/api/v1/capabilities')).status, 200);
  // And minting works again once trust is restored.
  assert.equal((await h.api(null, 'POST', '/api/devices', { name: 'after', preset: 'viewer' })).status, 201);
});
