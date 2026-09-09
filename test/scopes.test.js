'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const scopes = require('../modules/api-v1/scopes');

let admin, watch, viewer;

before(async () => {
  await H.start();
  admin  = H.mkDevice('admin', 'admin');
  watch  = H.mkDevice('watch', 'watch', H.WATCH_CAPS);
  viewer = H.mkDevice('viewer', 'viewer');
});
after(H.stop);

test('scope matching: wildcards and dotted prefixes', () => {
  assert.equal(scopes.hasScope(['*'], 'devices:admin'), true);
  assert.equal(scopes.hasScope(['read:*'], 'read:gpu.0'), true);
  assert.equal(scopes.hasScope(['read:system.*'], 'read:system.cpu'), true);
  assert.equal(scopes.hasScope(['read:system.*'], 'read:gpu.0'), false);
  assert.equal(scopes.hasScope(['command:compose.restart'], 'command:compose.stop'), false);
  assert.equal(scopes.hasScope(['interact'], 'interact'), true);
  assert.equal(scopes.hasScope(['read:*'], 'interact'), false);
  assert.deepEqual(scopes.normalizeAll(['read', 'bogus:x', 'interact:whatever', 'command:a.b']), ['read:*', 'interact', 'command:a.b']);
});

test('missing / invalid tokens are rejected', async () => {
  assert.equal((await H.api(null, 'GET', '/api/v1/capabilities')).status, 401);
  const r = await H.api('doca_dev_000000000000.nope', 'GET', '/api/v1/capabilities');
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'invalid_token');
  // discovery root is public
  assert.equal((await H.api(null, 'GET', '/api/v1/')).status, 200);
});

test('capabilities are filtered by scope', async () => {
  const w = (await H.api(watch.token, 'GET', '/api/v1/capabilities')).body;
  assert.equal(w.device.id, watch.device.id);
  assert.ok(w.surfaces.length > 0);
  assert.equal(w.commands.length, 0, 'watch preset has no command scopes');
  assert.ok(w.protocol.choiceTypes.includes('image'));
  assert.equal(w.render.defaults.round, true);
  const a = (await H.api(admin.token, 'GET', '/api/v1/capabilities')).body;
  assert.ok(a.commands.length > 5);
});

test('scope enforcement on routes', async () => {
  assert.equal((await H.api(watch.token, 'GET', '/api/v1/devices')).status, 403);
  assert.equal((await H.api(admin.token, 'GET', '/api/v1/devices')).status, 200);
  const c = await H.api(watch.token, 'POST', '/api/v1/commands/compose.restart', { params: {} });
  assert.equal(c.status, 403);
  assert.deepEqual(c.body.error.required, ['command:compose.restart']);
  assert.equal((await H.api(viewer.token, 'GET', '/api/v1/prompts')).status, 403, 'viewer lacks interact');
  assert.equal((await H.api(viewer.token, 'GET', '/api/v1/snapshot?surfaces=system.cpu')).status, 200);
  assert.equal((await H.api(watch.token, 'POST', '/api/v1/agent/prompts', { title: 'x', choices: [] })).status, 403);
  assert.equal((await H.api(viewer.token, 'GET', '/api/v1/surfaces/system.cpu')).status, 200);
});

test('narrow read scope hides other surfaces', async () => {
  const narrow = H.mkDevice('kiosk', 'viewer');
  require('../modules/api-v1/devices').update(narrow.device.id, { scopes: ['read:system.cpu'] });
  const caps = (await H.api(narrow.token, 'GET', '/api/v1/capabilities')).body;
  assert.deepEqual(caps.surfaces.map(s => s.id), ['system.cpu']);
  assert.equal((await H.api(narrow.token, 'GET', '/api/v1/surfaces/system.memory')).status, 403);
  const snap = (await H.api(narrow.token, 'GET', '/api/v1/snapshot')).body;
  assert.deepEqual(snap.surfaces.map(s => s.id), ['system.cpu']);
});

test('pairing flow issues a scoped token once', async () => {
  const start = await H.api(admin.token, 'POST', '/api/v1/devices/pair/start', { name: 'glasses', scopes: ['read:system.*', 'interact'] });
  assert.equal(start.status, 201);
  assert.match(start.body.code, /^\d{3}-\d{3}$/);
  const bad = await H.api(null, 'POST', '/api/v1/devices/pair/complete', { code: '000-000' });
  assert.equal(bad.status, 400);
  const done = await H.api(null, 'POST', '/api/v1/devices/pair/complete', { code: start.body.code, caps: { formFactor: 'glasses', input: { camera: true, voice: true }, audio: { mic: true, speaker: true } } });
  assert.equal(done.status, 201);
  assert.match(done.body.token, /^doca_dev_[0-9a-f]+\.[A-Za-z0-9_-]+$/);
  assert.equal(done.body.device.caps.formFactor, 'glasses');
  assert.equal(done.body.device.caps.screen, null, 'no display declared');
  assert.deepEqual(done.body.device.scopes, ['read:system.*', 'interact']);
  const again = await H.api(null, 'POST', '/api/v1/devices/pair/complete', { code: start.body.code });
  assert.equal(again.status, 400, 'code is single use');
  const caps = (await H.api(done.body.token, 'GET', '/api/v1/capabilities')).body;
  assert.ok(caps.surfaces.every(s => s.id.startsWith('system.')));
});

test('self-only scopes: profile and caps of another device are protected', async () => {
  const other = H.mkDevice('other', 'watch', H.WATCH_CAPS);
  const r = await H.api(watch.token, 'PUT', `/api/v1/devices/${other.device.id}/profile`, { pages: [] });
  assert.equal(r.status, 403);
  const ok = await H.api(watch.token, 'PUT', '/api/v1/devices/me/profile', { pages: [] });
  assert.equal(ok.status, 200);
  const patch = await H.api(watch.token, 'PATCH', '/api/v1/devices/me', { caps: { render: ['image'] }, scopes: ['*'] });
  assert.equal(patch.status, 200);
  assert.deepEqual(patch.body.device.scopes, watch.device.scopes, 'a device cannot escalate its own scopes');
});

test('rotation keeps the old token valid only within the grace period', async () => {
  const d = H.mkDevice('rot', 'viewer');
  const r = await H.api(d.token, 'POST', '/api/v1/devices/me/rotate');
  assert.equal(r.status, 200);
  assert.notEqual(r.body.token, d.token);
  assert.equal((await H.api(d.token, 'GET', '/api/v1/capabilities')).status, 200, 'old token still valid in grace');
  assert.equal((await H.api(r.body.token, 'GET', '/api/v1/capabilities')).status, 200);
});

test('revocation invalidates the token and closes a live stream', async () => {
  const d = H.mkDevice('doomed', 'watch', H.WATCH_CAPS);
  const stream = H.sse(d.token);
  await stream.ready;
  const r = await H.api(admin.token, 'DELETE', `/api/v1/devices/${d.device.id}`);
  assert.equal(r.status, 200);
  await stream.waitClosed();
  assert.equal(stream.closeReason, 'revoked');
  assert.ok(stream.events.some(e => e.type === 'revoked'));
  assert.equal((await H.api(d.token, 'GET', '/api/v1/capabilities')).status, 401);
  const self = await H.api(admin.token, 'DELETE', `/api/v1/devices/${admin.device.id}`);
  assert.equal(self.status, 400, 'cannot revoke self');
});

test('confirming an outcome with an action needs the command scope on the confirming device', async () => {
  const agent = H.mkDevice('agent', 'agent');
  const p = await H.api(agent.token, 'POST', '/api/v1/agent/prompts', {
    title: 'Restart?', targets: [watch.device.id],
    choices: [{ id: 'yes', type: 'option', label: 'Yes', outcome: { summary: 'Restart the stack', action: { commandId: 'compose.restart' } } }],
  });
  assert.equal(p.status, 201);
  const sel = await H.api(watch.token, 'POST', `/api/v1/prompts/${p.body.prompt.id}/select`, { selectionId: 'sel-scope-1', choiceId: 'yes' });
  assert.equal(sel.status, 200);
  assert.equal(sel.body.outcome.actionAllowed, false, 'view tells the client the action is out of scope');
  const conf = await H.api(watch.token, 'POST', `/api/v1/prompts/${p.body.prompt.id}/confirm`, { selectionId: 'sel-scope-1', decision: 'confirm' });
  assert.equal(conf.status, 403);
  assert.deepEqual(conf.body.error.required, ['command:compose.restart']);
});
