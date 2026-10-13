'use strict';

// Casting through one of the person's devices (R3f; cast/relay.js, clients/node/cast.js; PROTOCOL §22.5), end to end on
// loopback: the hub has no address on the TV's network, so it asks the person's doca-client that saw the TV; the
// client opens its own door, its own sender tells the Cast stand-in to load the page, and the stand-in fetches it from
// the client, which forwards to the hub with nothing of its own. A sound is served by the client itself.

process.env.DOCA_CLIENT_CAST_LOOPBACK = '1';   // the client's door on 127.0.0.1, for a "TV" at 127.0.0.1
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');
const castStub = require('./fixtures/cast-stub');

let dev, tts, tv, speaker;
const calls = [];
let originals = null;

test.before(async () => {
  const base = await H.start();
  dev = await castStub.start();
  tts = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(2345, 5)); });
  await new Promise(r => tts.listen(0, '127.0.0.1', r));
  const { loadPrefs, savePrefs } = require('../modules/utils');
  savePrefs({ ...loadPrefs(), voiceServices: { ttsUrl: `http://127.0.0.1:${tts.address().port}`, ttsModel: 'stub', ttsVoice: 'af_heart' } });
  const store = require('../modules/nearby/store');
  const how = { cast: { name: 'stub', ip: '127.0.0.1', port: dev.port } };
  const seenFrom = [{ by: 'd_home', label: 'Desk at home', network: 'home', address: '127.0.0.1', at: new Date().toISOString() }];
  store.writeSeen([
    { id: 's1', name: 'Living room TV', kind: 'tv', keys: ['cast:aa'], addresses: ['127.0.0.1'], can: ['cast'], how, sources: ['cast'], seenFrom },
    { id: 's2', name: 'Kitchen speaker', kind: 'speaker', keys: ['cast:bb'], addresses: ['127.0.0.1'], can: ['cast'], how, sources: ['cast'], seenFrom },
  ]);
  tv = store.save({ seenId: 's1', place: 'Home', room: 'Living room' });
  speaker = store.save({ seenId: 's2', place: 'Home', room: 'Kitchen' });
  // The person's own doca-client "Desk at home", lending nearby and cast: its real tools, called as the hub would.
  const tools = require('../clients/node/cast')({ tlsFor: () => ({}) });
  const cfg = { hub: base };
  const r = require('../modules/mcp/registry'), d = require('../modules/api-v1/devices');
  originals = { list: r.list, client: r.client, get: d.get };
  r.list = () => [...originals.list(), { id: 'client-home', origin: { kind: 'client', deviceId: 'd_home' }, state: 'running', tools: ['nearby_scan', ...Object.keys(tools)].map(name => ({ name })) }];
  r.client = id => (id === 'client-home' ? { callTool: async (name, args) => { calls.push({ name, args }); try { return JSON.stringify(await tools[name].run(cfg, args)); } catch (e) { return `Error: ${e.message}`; } } } : originals.client(id));
  d.get = id => (id === 'd_home' ? { id: 'd_home', name: 'Desk at home', userId: H.owner.user.id } : originals.get(id));
});
test.after(async () => {
  const r = require('../modules/mcp/registry'), d = require('../modules/api-v1/devices');
  Object.assign(r, { list: originals.list, client: originals.client }); d.get = originals.get;
  for (const id of [...require('../clients/node/cast')._doors.keys()]) require('../clients/node/cast')({ tlsFor: () => ({}) }).cast_end.run(null, { cast: id });
  await dev.close(); tts.close(); await H.stop();
});

test('a TV the hub cannot reach shows the page through the person\'s desk: its door, its sender, the hub behind it', async () => {
  const off = await H.api(null, 'POST', `/api/cast/things/${tv.id}/show`, { page: 'live' });
  assert.equal(off.status, 409, 'the owner\'s switch for a plain-HTTP door holds through a device too');
  assert.equal(off.body.code, 'switch_off');
  assert.equal(calls.length, 0, 'nothing asked of the desk');
  assert.equal((await H.api(null, 'POST', '/api/cast/door', { on: true })).status, 200);
  dev.fetched.length = 0;
  const r = await H.api(null, 'POST', `/api/cast/things/${tv.id}/show`, { page: 'live' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.via, 'Desk at home');
  assert.deepEqual(calls.map(c => c.name), ['cast_serve', 'cast_send']);
  assert.equal(calls[0].args.page, true);
  for (let i = 0; i < 100 && !dev.fetched.length; i++) await H.sleep(20);
  const got = dev.fetched[0];
  assert.match(got.url, /^http:\/\/127\.0\.0\.1:\d+\/api\/cast\/open\/[A-Z0-9]+$/, 'the TV fetched from the desk\'s door');
  assert.equal(got.status, 302, 'the hub opened the link through it: a view session');
  assert.doesNotMatch(String(got.cookie), /secure/i, 'the TV holds the cookie over HTTP');
  assert.ok(require('../modules/activity').list({ limit: 50 }).some(l => /through Desk at home/.test(l.what)));
  calls.length = 0;
});

test('the door adds nothing of its own, and answers only the TV', async () => {
  const doors = require('../clients/node/cast')._doors;
  const d = doors.get(`cast-${tv.id}`);
  assert.ok(d, 'the door is open');
  // A request carrying a bearer and DOCA's headers: they never reach the hub.
  const seen = [];
  const hub = http.createServer((req, res) => { seen.push(req.headers); res.writeHead(200, { 'Set-Cookie': 'a=1; Path=/; Secure; HttpOnly' }); res.end('ok'); });
  await new Promise(r => hub.listen(0, '127.0.0.1', r));
  const tools = require('../clients/node/cast')({ tlsFor: () => ({}) });
  const { base } = await tools.cast_serve.run({ hub: `http://127.0.0.1:${hub.address().port}` }, { cast: 'probe', target: '127.0.0.1', page: true });
  const res = await fetch(`${base}/x`, { headers: { Authorization: 'Bearer leak', 'X-Doca-Password': 'leak', Origin: base } });
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.headers.get('set-cookie'), /secure/i);
  assert.equal(seen[0].authorization, undefined);
  assert.equal(seen[0]['x-doca-password'], undefined);
  assert.equal(seen[0].host, `127.0.0.1:${hub.address().port}`);
  assert.equal(seen[0].origin, `http://127.0.0.1:${hub.address().port}`);
  if (process.platform === 'linux') {   // another address on the same network is turned away
    const other = await new Promise(resolve => http.get(`${base}/x`, { localAddress: '127.0.0.2' }, r => resolve(r.statusCode)).on('error', () => resolve('refused')));
    assert.equal(other, 404);
    assert.equal(seen.length, 1, 'nothing forwarded for it');
  }
  assert.equal(tools.cast_end.run(null, { cast: 'probe' }).ok, true);
  hub.close();
});

test('a speaker says it through the desk: the sound is served by the desk, and nothing is forwarded for it', async () => {
  dev.fetched.length = 0;
  const r = await H.api(null, 'POST', `/api/cast/things/${speaker.id}/say`, { text: 'Dinner is ready.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(calls.map(c => c.name), ['cast_serve', 'cast_send']);
  assert.equal(calls[0].args.page, undefined);
  assert.equal(Buffer.from(calls[0].args.media[0].data, 'base64').length, 2345);
  for (let i = 0; i < 100 && !dev.fetched.length; i++) await H.sleep(20);
  assert.equal(dev.fetched[0].status, 200);
  assert.equal(dev.fetched[0].bytes, 2345);
  const origin = new URL(dev.fetched[0].url).origin;
  assert.equal((await fetch(`${origin}/api/prefs`)).status, 404, 'a sound-only door forwards nothing');
  calls.length = 0;
});

test('stop and volume go through the desk too; stop closes its door', async () => {
  assert.equal((await H.api(null, 'POST', `/api/cast/things/${speaker.id}/volume`, { level: 0.3 })).status, 200);
  assert.equal((await H.api(null, 'POST', `/api/cast/things/${speaker.id}/stop`, {})).status, 200);
  assert.deepEqual(calls.map(c => c.name), ['cast_send', 'cast_send', 'cast_end']);
  assert.ok(!require('../clients/node/cast')._doors.has(`cast-${speaker.id}`));
});
