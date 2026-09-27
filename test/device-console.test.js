'use strict';

/** A device as a console: input goes to the linked devices only, and never anywhere else. */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H       = require('./helpers');
const devices = require('../modules/api-v1/devices');
const bus     = require('../modules/api-v1/bus');
const store   = require('../modules/store');
const consoleMod = require('../modules/device-console');
const { PRESETS } = require('../modules/api-v1/scopes');

test.before(() => H.start());
test.after(() => H.stop());

test('frames are cleaned, a press reaches the linked device durably, and an unlinked console reaches nobody', () => {
  consoleMod._reset();
  const watch = devices.create({ name: 'w', scopes: PRESETS.watch, caps: { formFactor: 'watch' } }).device;
  const rig = devices.create({ name: 'rig', scopes: ['read:*'], caps: { formFactor: 'headless' } }).device;

  // Nobody linked: kept for the panel, sent to no one.
  let r = consoleMod.ingest(watch, { enabled: true, frames: [{ t: 0, accel: [0, 0, 9.8], heading: 370 }, { t: 1, bogus: 1 }] });
  assert.deepEqual(r, { accepted: 1, press: null, linked: 0 });
  assert.equal(bus.drain(rig.id, 0).events.length, 0);

  store.writeJson('device-console', { [watch.id]: [rig.id] });
  r = consoleMod.ingest(watch, { press: 'B', frames: [{ t: 2, crown: 3 }] });
  assert.equal(r.linked, 1);
  const got = bus.drain(rig.id, 0).events.filter(e => e.type === 'console.input');
  assert.equal(got.length, 1, 'the press is durable, so a poller sees it');
  assert.equal(got[0].payload.press, 'B');
  assert.deepEqual(got[0].payload.frames, [{ t: 2, crown: 3 }]);

  // Not a button this console has.
  assert.equal(consoleMod.ingest(watch, { press: 'Z' }).press, null);
});
