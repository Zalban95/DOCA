'use strict';

/** A watch whose app is shut is woken through the phone that paired it (wake.js). */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H       = require('./helpers');
const devices = require('../modules/api-v1/devices');
const bus     = require('../modules/api-v1/bus');
const wake    = require('../modules/api-v1/wake');
const { PRESETS } = require('../modules/api-v1/scopes');

test.before(() => H.start());
test.after(() => H.stop());

const wakesFor = phoneId => bus.drain(phoneId, 0).events.filter(e => e.type === 'device.wake');

test('pairing records the phone that minted the code, and a question for its watch wakes that phone', () => {
  wake.start();
  wake._reset();
  const phone = devices.create({ name: 'phone', scopes: PRESETS.phone || ['devices:admin'], caps: { formFactor: 'phone' } }).device;
  const other = devices.create({ name: 'other phone', scopes: ['devices:admin'], caps: { formFactor: 'phone' } }).device;
  const { code } = devices.startPairing({ name: 'w', scopes: PRESETS.watch, createdBy: phone.id });
  const watch = devices.completePairing(code, { formFactor: 'watch' }).device;
  assert.equal(watch.pairedBy, phone.id);

  bus.publish(watch.id, 'prompt.new', { prompt: { id: 'p1' } });
  const w = wakesFor(phone.id);
  assert.equal(w.length, 1);
  // Only that it has something, never what: no payload of the event rides along.
  assert.deepEqual(w[0].payload, { deviceId: watch.id, type: 'prompt.new' });
  assert.equal(wakesFor(other.id).length, 0);

  // A second event inside the throttle window does not wake again; the one poll takes both.
  bus.publish(watch.id, 'alert', { id: 'a1', title: 't', body: [] });
  assert.equal(wakesFor(phone.id).length, 1);
});

test('a watch that is polling is not woken, and a watch paired before pairedBy falls back to phones that pair', () => {
  wake._reset();
  const phone = devices.create({ name: 'phone', scopes: ['devices:admin'], caps: { formFactor: 'phone' } }).device;
  const watch = devices.create({ name: 'old watch', scopes: PRESETS.watch, caps: { formFactor: 'watch' } }).device;
  assert.deepEqual(wake.phonesFor(watch).map(d => d.id).includes(phone.id), true);

  bus.drain(watch.id, 0);   // it just polled
  bus.publish(watch.id, 'prompt.new', { prompt: { id: 'p2' } });
  assert.equal(wakesFor(phone.id).length, 0);
});
