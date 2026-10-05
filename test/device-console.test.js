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

let firstWatch;

test('frames are cleaned, a press reaches the linked device durably, and an unlinked console reaches nobody', () => {
  consoleMod._reset();
  const watch = firstWatch = devices.create({ name: 'w', scopes: PRESETS.watch, caps: { formFactor: 'watch' } }).device;
  const rig = devices.create({ name: 'rig', scopes: ['read:*'], caps: { formFactor: 'headless' } }).device;

  // Nobody linked: kept for the panel, sent to no one.
  let r = consoleMod.ingest(watch, { enabled: true, frames: [{ t: 0, accel: [0, 0, 9.8], heading: 370 }, { t: 1, bogus: 1 }] });
  assert.deepEqual({ accepted: r.accepted, press: r.press, linked: r.linked }, { accepted: 1, press: null, linked: 0 });
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

const until = async (f, ms = 60000) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 50)); } };
const inputs = id => bus.drain(id, 0).events.filter(e => e.type === 'console.input').map(e => e.payload);

test('a toggle latches and says which way; switching the console off unlatches it', async () => {
  consoleMod._reset();
  const watch = devices.create({ name: 'w2', scopes: PRESETS.watch, caps: { formFactor: 'watch' } }).device;
  const rig = devices.create({ name: 'rig2', scopes: ['read:*'], caps: { formFactor: 'headless' } }).device;
  let r = await H.api(null, 'PUT', `/api/devices/${watch.id}/console`, { links: [rig.id] });
  assert.deepEqual(r.body.links, [rig.id]);
  r = await H.api(null, 'PUT', `/api/devices/${watch.id}/console/buttons`, { buttons: { A: { behaviour: 'toggle' }, B: { keys: 'ctrl+s' } } });
  assert.equal(r.body.A.behaviour, 'toggle');

  assert.deepEqual(consoleMod.ingest(watch, { press: 'A' }).toggles, { A: true, B: false, C: false });
  assert.equal(consoleMod.ingest(watch, { press: 'A' }).toggles.A, false);
  consoleMod.ingest(watch, { press: 'A' });
  consoleMod.ingest(watch, { press: 'B' });
  const got = inputs(rig.id);
  assert.deepEqual(got.slice(0, 3).map(p => p.button.down), [true, false, true]);
  assert.deepEqual(got[3].button, { id: 'B', behaviour: 'button', down: true });
  assert.deepEqual(got[3].macro, { keys: 'ctrl+s' }, 'keys mode: the press carries its macro');
  assert.equal(consoleMod.ingest(watch, { enabled: false }).toggles.A, false);
});

test('joystick mode is chosen from the watch, turns tilt into axes, and sends no macros', async () => {
  consoleMod._reset();
  const watch = devices.create({ name: 'w3', scopes: PRESETS.watch, caps: { formFactor: 'watch' } }).device;
  const rig = devices.create({ name: 'rig3', scopes: ['read:*'], caps: { formFactor: 'headless' } }).device;
  store.writeJson('device-console', { ...store.readJson('device-console', {}), [watch.id]: { links: [rig.id], buttons: { A: { keys: 'space' } } } });
  const r = consoleMod.ingest(watch, { mode: 'joystick', frames: [{ t: 0, accel: [9.81 / 2, -20, 5], crown: 2 }, { t: 50, crown: 3 }] });
  assert.equal(r.mode, 'joystick');
  assert.equal(consoleMod.configOf(watch.id).mode, 'joystick', 'kept: the next batch is in the same mode');
  consoleMod.ingest(watch, { press: 'A' });
  // Frames are ephemeral (live subscribers only), so the axes are read where the panel reads them.
  assert.deepEqual((await H.api(null, 'GET', `/api/devices/${watch.id}/console`)).body.joystick, { x: 0.5, y: -1, crown: 5 });
  const [press] = inputs(rig.id);
  assert.equal(press.macro, undefined);
  assert.equal(press.button.id, 'A');
});

test('the host runs a button\'s command only when it is a receiver, told the button and its state', async () => {
  consoleMod._reset();
  const watch = devices.create({ name: 'w4', scopes: PRESETS.watch, caps: { formFactor: 'watch' } }).device;
  const cmd = `node -e "console.log(process.env.DOCA_BUTTON + '=' + process.env.DOCA_BUTTON_STATE)"`;
  await H.api(null, 'PUT', `/api/devices/${watch.id}/console/buttons`, { buttons: { C: { behaviour: 'toggle', run: cmd } } });
  consoleMod.ingest(watch, { press: 'C' });
  let c = (await H.api(null, 'GET', `/api/devices/${watch.id}/console`)).body;
  assert.equal(c.lastRun, null, 'not a receiver: nothing ran');

  await H.api(null, 'PUT', `/api/devices/${watch.id}/console`, { host: true });
  consoleMod.ingest(watch, { press: 'C' });   // latches off: the second press of this toggle
  let run;
  await until(async () => (run = (await H.api(null, 'GET', `/api/devices/${watch.id}/console`)).body.lastRun) && !run.running);
  assert.equal(run.code, 0, JSON.stringify(run));
  assert.equal(run.out, 'C=off');
});

test('buttons are edited under host; the file is out of the file tools\' reach; the agent sees where a console goes', () => {
  const rights = require('../modules/auth/rights');
  assert.equal(rights.rightFor('PUT', '/api/devices/dev_x/console/buttons'), 'host');
  assert.equal(rights.rightFor('PUT', '/api/devices/dev_x/console'), 'devices');
  const { fmSafe } = require('../modules/utils');
  assert.equal(fmSafe(require('path').join(store.DATA_DIR, 'device-console.json')), false);

  const out = consoleMod.summary(firstWatch.id, id => devices.get(id)?.name || id);
  assert.match(out, /^console=(on|off),keys → rig$/);
  const fresh = devices.create({ name: 'never', scopes: PRESETS.watch, caps: { formFactor: 'watch' } }).device;
  assert.equal(consoleMod.summary(fresh.id), null, 'no console used or linked: no words spent on it');
});
