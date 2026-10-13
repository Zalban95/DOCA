'use strict';

// Casting to things Nearby saved (modules/cast/things.js, door.js, media.js; docs/design/cast-reach.md phase A), against
// a Cast device stand-in that fetches what it is given as a real one does, and a speech service stand-in. The door
// listens on loopback here (DOCA_CAST_DOOR_ADDRESS, port 0); on a hub it is the address on the device's network.

process.env.DOCA_CAST_DOOR_ADDRESS = '127.0.0.1';
process.env.DOCA_CAST_DOOR_PORT = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');
const castStub = require('./fixtures/cast-stub');

let dev, tts, tv, speaker;
test.before(async () => {
  await H.start();
  dev = await castStub.start();
  tts = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(4321, 7)); });
  await new Promise(r => tts.listen(0, '127.0.0.1', r));
  const { loadPrefs, savePrefs } = require('../modules/utils');
  savePrefs({ ...loadPrefs(), voiceServices: { ttsUrl: `http://127.0.0.1:${tts.address().port}`, ttsModel: 'stub', ttsVoice: 'af_heart' } });
  const store = require('../modules/nearby/store');
  const how = { cast: { name: 'stub', ip: '127.0.0.1', port: dev.port } };
  store.writeSeen([
    { id: 's1', name: 'Living room TV', kind: 'tv', keys: ['cast:aa'], addresses: ['127.0.0.1'], can: ['cast'], how, sources: ['cast'], model: 'Stub TV' },
    { id: 's2', name: 'Kitchen speaker', kind: 'speaker', keys: ['cast:bb'], addresses: ['127.0.0.1'], can: ['cast'], how, sources: ['cast'], model: 'Stub speaker' },
  ]);
  tv = store.save({ seenId: 's1', place: 'Home', room: 'Living room' });
  speaker = store.save({ seenId: 's2', place: 'Home', room: 'Kitchen' });
});
test.after(async () => { await require('../modules/cast/door').close(); await dev.close(); tts.close(); await H.stop(); });

const lines = () => require('../modules/activity').list({ limit: 100 });

test('the sheet lists the saved Cast devices by place and room; a member only what is allotted', async () => {
  const r = await H.api(null, 'GET', '/api/cast/things');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.things.map(t => [t.name, t.room, t.shows]), [['Kitchen speaker', 'Kitchen', false], ['Living room TV', 'Living room', true]]);
  assert.deepEqual(r.body.door, { on: false, mayChange: true });
  const member = await H.signIn('member');
  const m = await H.api(null, 'GET', '/api/cast/things', undefined, { Cookie: member.cookie });
  assert.deepEqual(m.body.things, [], 'nothing allotted: nothing listed (admins first, auth/allot.js)');
  assert.equal((await H.api(null, 'POST', `/api/cast/things/${tv.id}/stop`, {}, { Cookie: member.cookie })).status, 403);
});

test('the door is off until the owner switches it on, with the password', async () => {
  const r = await H.api(null, 'POST', `/api/cast/things/${tv.id}/show`, { page: 'live' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /cast door is off/);
  assert.equal((await H.api(null, 'POST', '/api/cast/door', { on: true }, { 'X-Doca-Password': '' })).status, 401, 'the password is asked');
  assert.equal((await H.api(null, 'POST', '/api/cast/door', { on: true })).status, 200);
});

test('a TV shows the page: DashCast opens a one-time view link through the door, and nothing else passes', async () => {
  dev.fetched.length = 0;
  const r = await H.api(null, 'POST', `/api/cast/things/${tv.id}/show`, { page: 'live' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (let i = 0; i < 50 && !dev.fetched.length; i++) await H.sleep(20);
  const got = dev.fetched[0];
  assert.match(got.url, /^http:\/\/127\.0\.0\.1:\d+\/api\/cast\/open\/[A-Z0-9]+$/);
  assert.equal(got.status, 302, 'the link opened: a view session, then the page');
  assert.match(got.location, /\/\?view=live&cast=1/);
  assert.ok(dev.heard.some(m => m.data?.type === 'LAUNCH' && m.data.appId === '84912283'), 'DashCast was launched');
  const origin = new URL(got.url).origin;
  assert.equal((await fetch(`${origin}/api/prefs`)).status, 404, 'the panel\'s other routes are not behind the door');
  assert.equal((await fetch(`${origin}/api/cast/open/${new URL(got.url).pathname.split('/').pop()}`)).status, 410, 'and the link is spent');
  assert.ok(lines().some(l => l.act === 'cast' && l.machine?.kind === 'nearby' && l.machine.id === tv.id));
});

test('a speaker says a sentence in the person\'s voice, fetched once from the door by that device alone', async () => {
  dev.fetched.length = 0;
  const r = await H.api(null, 'POST', `/api/cast/things/${speaker.id}/say`, { text: 'Dinner is ready.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const got = dev.fetched[0];
  assert.match(got.url, /\/api\/cast\/media\/[0-9a-f]{32}$/);
  assert.deepEqual([got.status, got.bytes, got.type], [200, 4321, 'audio/mpeg']);
  assert.ok(dev.heard.some(m => m.data?.type === 'LOAD' && m.data.media?.contentType === 'audio/mpeg'));
  assert.equal((await fetch(`${H.base}/api/cast/media/${got.url.split('/').pop()}`, { headers: { Cookie: '' } })).status, 404, 'never to anyone else: the panel\'s own address is not the device\'s');
  assert.equal((await H.api(null, 'POST', `/api/cast/things/${speaker.id}/say`, { text: '  ' })).status, 400);
});

test('stop ends what plays, and is a line', async () => {
  assert.equal((await H.api(null, 'POST', `/api/cast/things/${speaker.id}/stop`, {})).status, 200);
  const s = await require('../modules/cast/castv2/sender').connect({ host: '127.0.0.1', port: dev.port });
  try { assert.deepEqual((await s.status()).applications, []); } finally { s.close(); }
  assert.ok(lines().some(l => l.act === 'stop' && l.machine?.id === speaker.id));
});

test('the door\'s port is neither the panel\'s nor the previews\' beside it (found 2026-10-13: it was PORT + 1)', () => {
  const port = require('../modules/settings-schema').value('cast.doorPort');
  assert.notEqual(port, 4242);
  assert.notEqual(port, 4243, 'canvas/origin.js serves previews on PORT + 1');
});
