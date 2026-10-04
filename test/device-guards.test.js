'use strict';

// A device cannot become someone else's, grant more than it holds, or mint ownerless devices (audit 2026-10-04).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const devices = require('../modules/api-v1/devices');

let phone, member;
before(async () => {
  await H.start();
  member = await H.signIn('member');
  phone = H.mkDevice('member phone', 'phone', H.PHONE_CAPS);
  devices.update(phone.device.id, { userId: member.user.id, orgId: member.orgId });
});
after(() => H.stop());

test('PATCH never changes whose device it is', async () => {
  const r = await H.api(phone.token, 'PATCH', '/api/v1/devices/me', { userId: H.owner.user.id, orgId: 'x', pairedBy: 'y', name: 'renamed' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = devices.get(phone.device.id);
  assert.equal(d.userId, member.user.id, 'still the member\'s');
  assert.equal(d.name, 'renamed', 'the name did change');
});

test('a device grants only scopes it holds — to itself or to a new device', async () => {
  const self = await H.api(phone.token, 'PATCH', '/api/v1/devices/me', { scopes: ['*'] });
  assert.equal(self.status, 403);
  assert.equal(self.body.error.code ?? self.body.code, 'scope_exceeds_own');
  const mint = await H.api(phone.token, 'POST', '/api/v1/devices', { preset: 'admin', name: 'x' });
  assert.equal(mint.status, 403);
  const watch = await H.api(phone.token, 'POST', '/api/v1/devices', { preset: 'watch', name: 'my watch' });
  assert.equal(watch.status, 201, 'a watch is within a phone');
  assert.equal(devices.get(watch.body.device.id).userId, member.user.id, 'and it belongs to the phone\'s owner');
});

test('a watch paired through a phone belongs to the phone\'s owner', async () => {
  const start = await H.api(phone.token, 'POST', '/api/v1/devices/pair/start', { preset: 'watch', name: 'paired watch' });
  assert.equal(start.status, 201);
  const done = await H.api(null, 'POST', '/api/v1/devices/pair/complete', { code: start.body.code, caps: H.WATCH_CAPS });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(devices.get(done.body.device.id).userId, member.user.id);
});

test('wrong pairing codes are throttled for everyone after ten a minute', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await H.api(null, 'POST', '/api/v1/devices/pair/complete', { code: String(100000 + i) });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get ? last.headers.get('retry-after') : last.headers['retry-after']) > 0);
});
