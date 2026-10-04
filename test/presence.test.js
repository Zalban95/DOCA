'use strict';

// Whether somebody is reading the panel, said by the panel itself (modules/presence.js).

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const presence = require('../modules/presence');

before(() => H.start());
after(() => H.stop());
beforeEach(() => presence._reset());

test('nobody has looked yet: the agent is told a device is how to reach them', () => {
  assert.deepEqual(presence.state(), { atPanel: false, who: null, ago: null });
  assert.match(presence.line(), /has not been open since the server started.*tell_device/);
});

test('a visible heartbeat is "at the panel"; a hidden one, or silence, is not', async () => {
  const r = await H.api(null, 'POST', '/api/presence', { visible: true });
  assert.equal(r.status, 200);
  assert.equal(presence.state().atPanel, true);
  assert.match(presence.line(), /at the panel now \(owner\)/);

  await H.api(null, 'POST', '/api/presence', { visible: false });
  assert.equal(presence.state().atPanel, false, 'a hidden tab is read by nobody');

  await H.api(null, 'POST', '/api/presence', { visible: true });
  const later = Date.now() + presence.FRESH_MS + 1000;
  assert.equal(presence.state(later).atPanel, false, 'two missed heartbeats and it is over');
  assert.match(presence.line(later), /not at the panel \(last seen \d+s ago\)/);
});

test('it needs a signed-in person, and it reaches the agent\'s readings, not the cached prefix', async () => {
  const anon = await H.api(null, 'POST', '/api/presence', { visible: true }, { Cookie: '' });
  assert.equal(anon.status, 401);
  await H.api(null, 'POST', '/api/presence', { visible: true });
  const { liveBlock } = require('../modules/harness/turn/prompt');
  assert.match(liveBlock({}, null), /owner: at the panel now/);
  const preview = require('../modules/harness/agent').preview({ message: 'hi' });
  assert.equal(typeof preview, 'string');
  assert.match(preview, /# Standing rules/);
  assert.doesNotMatch(preview, /owner: at the panel/, 'a per-step reading never sits ahead of the transcript (H-9)');
});

test('the hub\'s own pushes carry quiet: true while somebody reads the panel, and only then', async () => {
  const devices = require('../modules/api-v1/devices');
  const bus = require('../modules/api-v1/bus');
  const { PRESETS } = require('../modules/api-v1/scopes');
  const workview = require('../modules/harness/workview');
  const work = require('../modules/harness/organization').create({ title: 'Quiet job' });
  const phone = devices.create({ name: 'quiet phone', scopes: PRESETS.phone, caps: { formFactor: 'phone' } }).device;
  const last = () => bus.drain(phone.id, 0).events.filter(e => e.type === 'agent.mission').at(-1);

  workview.announce(work.id);
  assert.equal(last().payload.quiet, undefined, 'nobody at the panel: notify as before');

  presence.beat({ id: 'u1', name: 'owner' }, true);
  assert.deepEqual(presence.quietFlag(), { quiet: true });
  workview.announce(work.id);
  assert.equal(last().payload.quiet, true, 'update, do not notify');

  presence.beat({ id: 'u1', name: 'owner' }, false);
  workview.announce(work.id);
  assert.equal(last().payload.quiet, undefined, 'a hidden tab is nobody reading');
});
