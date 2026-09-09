'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const sampler = require('../modules/api-v1/sampler');

let phone, watch;

before(async () => {
  await H.start();
  phone = H.mkDevice('phone', 'phone', H.PHONE_CAPS);
  watch = H.mkDevice('watch', 'watch', H.WATCH_CAPS);
});
after(H.stop);

test('phone authors the watch profile; watch receives profile.changed live without restart', async () => {
  const s = H.sse(watch.token); await s.ready;
  const g0 = await H.api(phone.token, 'GET', `/api/v1/devices/${watch.device.id}/profile`);
  assert.equal(g0.status, 200); assert.equal(g0.body.profile.version, 0);
  const etag0 = g0.headers.get('etag');

  const body = { refreshSec: 5, pages: [{ id: 'home', surfaces: [{ id: 'system.cpu', metrics: ['system.cpu.pct'], spark: true }, 'gpu.0'] }], commands: ['compose.restart'], sensors: { allow: ['heartRate'] }, ext: { theme: 'amber' } };
  const put = await H.api(phone.token, 'PUT', `/api/v1/devices/${watch.device.id}/profile`, body, { 'If-Match': etag0 });
  assert.equal(put.status, 200);
  assert.equal(put.body.profile.version, 1);
  assert.equal(put.body.profile.updatedBy, phone.device.id);
  assert.deepEqual(put.body.profile.commands, [], 'command outside the watch token scopes is stripped…');
  assert.deepEqual(put.body.profile.warnings.map(w => w.code), ['command_not_in_scope']);
  assert.deepEqual(put.body.profile.ext, { theme: 'amber' });

  const ev = await s.waitFor('profile.changed');
  assert.equal(ev.class, 'durable'); assert.equal(ev.payload.version, 1); assert.equal(ev.payload.updatedBy, phone.device.id);

  const mine = await H.api(watch.token, 'GET', '/api/v1/devices/me/profile');
  assert.equal(mine.headers.get('etag'), ev.payload.etag);
  assert.equal(mine.body.profile.pages[0].surfaces[1].id, 'gpu.0');
  const notModified = await H.api(watch.token, 'GET', '/api/v1/devices/me/profile', undefined, { 'If-None-Match': ev.payload.etag });
  assert.equal(notModified.status, 304);
  const caps = (await H.api(watch.token, 'GET', '/api/v1/capabilities')).body;
  assert.equal(caps.profile.version, 1, 'capabilities also reports the profile version so an offline client cannot miss an edit');
  s.close();
});

test('optimistic concurrency: stale If-Match is rejected with 412', async () => {
  const r = await H.api(phone.token, 'PUT', `/api/v1/devices/${watch.device.id}/profile`, { pages: [] }, { 'If-Match': '"v0"' });
  assert.equal(r.status, 412); assert.equal(r.body.error.code, 'etag_mismatch'); assert.equal(r.body.error.currentVersion, 1);
  const ok = await H.api(phone.token, 'PUT', `/api/v1/devices/${watch.device.id}/profile`, { pages: [] }, { 'If-Match': '"v1"' });
  assert.equal(ok.status, 200); assert.equal(ok.body.profile.version, 2);
});

test('profile validation clamps and drops junk', async () => {
  const r = await H.api(watch.token, 'PUT', '/api/v1/devices/me/profile', { refreshSec: 0, pages: [{ id: 'p', surfaces: [{ id: 'system.cpu', maxItems: 999 }, 42, { nope: true }] }, 'bad'], quietHours: { from: '25:00', to: 'x' }, ext: { big: 'x'.repeat(9000) } });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'ext_too_large');
  const ok = await H.api(watch.token, 'PUT', '/api/v1/devices/me/profile', { refreshSec: 0, pages: [{ id: 'p', surfaces: [{ id: 'system.cpu', maxItems: 999 }, 42, { nope: true }] }, 'bad'], quietHours: { from: '25:00', to: 'x' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.profile.refreshSec, 2, 'clamped to the sampler floor');
  assert.equal(ok.body.profile.pages.length, 1);
  assert.deepEqual(ok.body.profile.pages[0].surfaces, [{ id: 'system.cpu', maxItems: 40 }]);
  assert.equal(ok.body.profile.quietHours, null);
});

test('live surface.update follows the profile: only listed surfaces, sparklines when asked', async () => {
  await H.api(watch.token, 'PUT', '/api/v1/devices/me/profile', { refreshSec: 2, pages: [{ id: 'home', surfaces: [{ id: 'system.memory', spark: true }] }] });
  const s = H.sse(watch.token); await s.ready;
  await sampler.refresh();
  const ev = await s.waitFor('surface.update', 8000);
  assert.equal(ev.class, 'ephemeral');
  assert.equal(ev.payload.surface.id, 'system.memory');
  const pct = ev.payload.surface.metrics.find(m => m.id === 'system.memory.pct');
  assert.equal(pct.unit, '%'); assert.ok(pct.thresholds.length === 2); assert.equal(typeof pct.display, 'string');
  assert.ok(pct.observedAt && pct.ttlSec > 0);
  await sampler.refresh(); await H.sleep(2200); await sampler.refresh();
  const later = s.events.filter(e => e.type === 'surface.update');
  assert.ok(later.every(e => e.payload.surface.id === 'system.memory'), 'never pushes surfaces the profile does not list');
  const withSpark = later.find(e => e.payload.surface.metrics.find(m => m.id === 'system.memory.pct')?.spark);
  assert.ok(withSpark, 'spark array appears once history has ≥2 points');
  s.close();
});

test('snapshot honours spark opt-in and sends server-formatted display strings', async () => {
  const r = await H.api(watch.token, 'GET', '/api/v1/snapshot?surfaces=system.cpu,system.host&spark=1');
  assert.equal(r.status, 200);
  const cpu = r.body.surfaces.find(s => s.id === 'system.cpu');
  const cores = cpu.metrics.find(m => m.id === 'system.cpu.cores');
  assert.equal(cores.kind, 'vector'); assert.ok(Array.isArray(cores.value));
  const host = r.body.surfaces.find(s => s.id === 'system.host');
  const up = host.metrics.find(m => m.id === 'system.host.uptime');
  assert.equal(up.kind, 'duration'); assert.match(up.display, /\d+[dhm]/);
  assert.ok(r.headers.get('etag'));
  const nm = await H.api(watch.token, 'GET', '/api/v1/snapshot?surfaces=system.host', undefined, { 'If-None-Match': (await H.api(watch.token, 'GET', '/api/v1/snapshot?surfaces=system.host')).headers.get('etag') });
  assert.ok([200, 304].includes(nm.status));
});
