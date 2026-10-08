'use strict';

/**
 * Devices as hands (docs/design/devices-as-hands.md): actions on a paired
 * device, what it reports it granted, and its own page at /d/<id>/.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H       = require('./helpers');
const devices = require('../modules/api-v1/devices');
const bus     = require('../modules/api-v1/bus');
const control = require('../modules/devices-control');

test.before(() => H.start());
test.after(() => H.stop());

test('actions reach the device as device.control, and the device answers; revoke and restore a family', async () => {
  const { device, token } = H.mkDevice('portal', 'phone', { ...H.PHONE_CAPS, formFactor: 'desktop' });
  const sent = await H.api(null, 'POST', `/api/devices/${device.id}/control`, { action: 'refresh' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const ev = bus.drain(device.id, 0).events.find(e => e.type === 'device.control');
  assert.deepEqual({ action: ev.payload.action, family: ev.payload.family }, { action: 'refresh', family: null });

  // The device reports what it granted, and acknowledges the action.
  const g = await H.api(token, 'PUT', '/api/v1/devices/self/grants', { grants: { files: true, shell: true, screen: false, bogus: true } });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.deepEqual(g.body.grants, { files: true, shell: true, screen: false }, 'unknown families are ignored');
  const a = await H.api(token, 'POST', `/api/v1/devices/self/control/${ev.payload.id}/ack`, { ok: true, detail: 'caps sent' });
  assert.equal(a.body.control.detail, 'caps sent');

  assert.equal((await H.api(null, 'POST', `/api/devices/${device.id}/control`, { action: 'revoke' })).status, 400, 'revoke needs a family');
  await H.api(null, 'POST', `/api/devices/${device.id}/control`, { action: 'revoke', family: 'shell' });
  assert.deepEqual(control.state(device.id).usable, ['files'], 'a revoked family is not offered');
  // Its MCP server's card can say why it offers no tools (deep test B: "0 tools" with no reason).
  const registry = require('../modules/mcp/registry');
  registry.upsert({ id: 'portal-mcp', transport: 'http', url: 'http://127.0.0.1:9/mcp', origin: { kind: 'client', deviceId: device.id } });
  const card = (await H.api(null, 'GET', '/api/mcp')).body.servers.find(x => x.id === 'portal-mcp');
  assert.deepEqual(card.revokedHere, ['shell']);
  registry.remove('portal-mcp');
  await H.api(null, 'POST', `/api/devices/${device.id}/control`, { action: 'restore', family: 'shell' });
  assert.deepEqual(control.state(device.id).usable, ['files', 'shell']);
  const list = await H.api(null, 'GET', '/api/devices');
  assert.equal(list.body.devices.find(d => d.id === device.id).control.history.length, 3, 'refresh, revoke, restore');
});

test('disconnect ends the device\'s panel sessions and its live stream, and it stays paired', async () => {
  const { device } = H.mkDevice('laptop', 'phone', { ...H.PHONE_CAPS, formFactor: 'desktop' });
  const authStore = require('../modules/auth/store');
  authStore.createSession('h-device-session', { userId: H.owner.user.id, orgId: H.owner.orgId, deviceId: device.id, expiresAt: new Date(Date.now() + 3600e3).toISOString() });
  let closed = null;
  const { unsubscribe } = bus.subscribe(device.id, 0, { send() {}, close(reason) { closed = reason; } });
  await H.api(null, 'POST', `/api/devices/${device.id}/control`, { action: 'disconnect' });
  await H.sleep(400);
  assert.equal(closed, 'disconnect', 'its stream was closed by DOCA itself');
  assert.equal(authStore.sessionByHash('h-device-session'), null, 'its sign-in session ended');
  assert.equal(control.state(device.id).disconnected, true);
  assert.ok(!devices.get(device.id).revokedAt, 'not unpaired');
  unsubscribe();
});

test('/d/<id>/ is the device\'s own page: its owner gets the panel, anyone else does not', async () => {
  const mine = H.mkDevice('my phone', 'phone', H.PHONE_CAPS).device;
  devices.update(mine.id, { userId: H.owner.user.id, orgId: H.owner.orgId });
  const page = await H.api(null, 'GET', `/d/${mine.id}/`, undefined, { Accept: 'text/html' });
  assert.equal(page.status, 200);
  assert.match(page.body, /<html/i);
  const other = await H.signIn('member');
  const theirs = H.mkDevice('their phone', 'phone', H.PHONE_CAPS).device;
  devices.update(theirs.id, { userId: other.user.id, orgId: other.orgId });
  assert.equal((await H.api(null, 'GET', `/d/${theirs.id}/`, undefined, { Accept: 'text/html' })).status, 404, 'a device id is not a key');
  assert.equal((await H.api(null, 'GET', '/d/dev_nothere/', undefined, { Accept: 'text/html' })).status, 404);
});
