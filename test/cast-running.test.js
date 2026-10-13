'use strict';

// Casts kept across a restart (R3e; cast/running.js): a page cast to a TV is noted and forgotten at Stop; at start the
// door is opened again for those of the last day — only while the owner's switch is on, and never a relay's.
process.env.DOCA_CAST_DOOR_ADDRESS = '127.0.0.1';
process.env.DOCA_CAST_DOOR_PORT = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

test.before(() => H.start());
test.after(async () => { await require('../modules/cast/door').close(); await H.stop(); });

const running = () => require('../modules/cast/running');
const door = () => require('../modules/cast/door');
const setDoor = on => { const u = require('../modules/utils'); u.savePrefs({ ...u.loadPrefs(), cast: { door: on ? 'on' : 'off' } }); };

test('noted, replaced per thing, forgotten', () => {
  running().note({ thing: 't1', ip: '192.168.1.40', page: 'live' });
  running().note({ thing: 't1', ip: '192.168.1.40', page: 'home' });
  assert.deepEqual(running().all().map(c => [c.thing, c.page]), [['t1', 'home']]);
  assert.ok(!JSON.stringify(running().all()).match(/code|session|cookie/), 'no link code or session is kept');
  running().forget('t1');
  assert.deepEqual(running().all(), []);
});

test('at start: the door again for the hub\'s own page casts of the last day, while the switch is on', async () => {
  require('../modules/store').writeJson('cast-running', { casts: [
    { thing: 'tv', ip: '127.0.0.1', page: 'live', at: new Date().toISOString() },
    { thing: 'old', ip: '127.0.0.2', page: 'live', at: new Date(Date.now() - 2 * running().KEEP_MS).toISOString() },
    { thing: 'far', ip: '127.0.0.3', page: 'live', via: 'client-home', at: new Date().toISOString() },
  ] });
  setDoor(false);
  assert.equal(await running().restore(), 0, 'the switch off: nothing opens');
  assert.equal(door().state().listening, null);
  setDoor(true);
  assert.equal(await running().restore(), 1);
  assert.deepEqual(door().state().casts, ['127.0.0.1'], 'only the hub\'s own, not a relay\'s');
  assert.ok(!running().all().some(c => c.thing === 'old'), 'one older than a day is dropped');
  assert.ok(require('../modules/activity').list({ limit: 20 }).some(l => /opened the cast door again for 1 screen/.test(l.what)));
});
