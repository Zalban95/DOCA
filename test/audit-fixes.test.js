'use strict';

/**
 * The resident agent's audit of 2026-09-26 (Desktop, DOCA-issues-audit-…-2.73.1.md):
 * the fixes that are not covered by a test of their own elsewhere.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H       = require('./helpers');
const devices = require('../modules/api-v1/devices');
const bus     = require('../modules/api-v1/bus');
const store   = require('../modules/store');
const { PRESETS } = require('../modules/api-v1/scopes');

test.before(() => H.start());
test.after(() => H.stop());

test('§4f: a device is never named "null"; names stored that way are repaired at boot', () => {
  assert.equal(devices.cleanName('null', 'dev_x'), 'dev_x');
  assert.equal(devices.cleanName('  ', 'dev_x'), 'dev_x');
  assert.equal(devices.cleanName(' My watch ', 'dev_x'), 'My watch');
  const { device } = devices.create({ name: 'null', scopes: PRESETS.watch, caps: { formFactor: 'watch' } });
  assert.equal(device.name, device.id);
  // One stored before the fix.
  const doc = store.readJson('devices');
  doc.devices[device.id].name = 'null';
  store.writeJson('devices', doc);
  devices._reset?.();
  assert.equal(devices.repairNames(), 1);
  assert.equal(devices.get(device.id).name, `watch ${device.id.slice(-4)}`);
});

test('N4: scopes a preset gained since pairing are reported, and granted only on a click — same id', async () => {
  const old = PRESETS.phone.filter(s => !s.startsWith('harness:'));
  const { device } = devices.create({ name: 'Old desktop', scopes: old, caps: { formFactor: 'desktop' } });
  let r = await H.api(null, 'GET', '/api/devices');
  const row = r.body.devices.find(d => d.id === device.id);
  assert.deepEqual(row.missingScopes, ['harness:chat', 'harness:sessions']);
  assert.equal(devices.get(device.id).scopes.includes('harness:chat'), false, 'reported, not granted');

  r = await H.api(null, 'POST', `/api/devices/${device.id}/scopes`, { add: ['harness:chat', '*'] });
  assert.equal(r.status, 200);
  assert.ok(devices.get(device.id).scopes.includes('harness:chat'));
  assert.equal(devices.get(device.id).scopes.includes('*'), false, 'only what its preset grants');
  assert.deepEqual(r.body.device.missingScopes, ['harness:sessions']);
  assert.equal((await H.api(null, 'POST', `/api/devices/${device.id}/scopes`, { add: ['admin'] })).status, 400);
});

test('N5: outbox files of devices that no longer exist are collected; live ones are kept', () => {
  const { device } = devices.create({ name: 'Kept', scopes: PRESETS.watch });
  bus.publish(device.id, 'alert', { title: 'x' });
  const dir = store.dir('outbox');
  fs.writeFileSync(path.join(dir, 'dev_gone000000.jsonl'), '{"seq":1}\n');
  fs.writeFileSync(path.join(dir, 'dev_gone000000.meta.json'), '{}');
  const removed = bus.collectOrphans(devices.list().map(d => d.id));
  assert.deepEqual(removed, ['dev_gone000000']);
  assert.ok(fs.existsSync(path.join(dir, `${device.id}.jsonl`)));
});

test('N3: a final report is kept whole (a progress note stays short)', () => {
  const org = require('../modules/harness/organization');
  const s = org.create({ title: 'Long report' });
  const long = 'x'.repeat(5000);
  const done = org.report(s.id, 'done', long);
  assert.equal(done.text.length, 5000);
  assert.equal(done.textTruncated, undefined);
  assert.equal(org.report(s.id, 'report', long).text.length, 600);
  assert.equal(org.report(s.id, 'done', 'y'.repeat(30000)).textTruncated, true);
});

test('§4g: a fallback entry whose provider is gone is announced, not dropped in silence', async () => {
  const { complete } = require('../modules/harness/turn/transport');
  const skips = [];
  const p = { ...require('../modules/harness/agent').params(), fallbackChain: [{ provider: 'deleted-provider', model: 'm' }] };
  await complete({ ep: { id: 'nowhere', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '' }, p, onSkip: s => skips.push(s),
    body: { model: 'm', messages: [{ role: 'user', content: 'hi' }] } }).catch(() => {});
  assert.equal(skips.length, 1);
  assert.match(skips[0].text, /Fallback entry 1 \(deleted-provider \/ m\) is skipped: that provider is no longer in Settings → API Keys/);
});
