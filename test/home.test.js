'use strict';

/**
 * The Home page (modules/home, TODO H10.10) against a stub Home Assistant: its WebSocket API (auth, get_states,
 * get_config, the registries, subscribe_events, call_service) and its camera proxy. No real HA.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');
const { WebSocketServer } = require('ws');

const TOKEN = 'ha-long-lived-token-123';
const ha = { calls: [], sockets: new Set(), cameraAuth: null, connects: 0 };
const STATES = [
  { entity_id: 'light.kitchen', state: 'off', attributes: { friendly_name: 'Kitchen light', supported_color_modes: ['brightness'], entity_picture: '/api/x?token=SECRET' } },
  { entity_id: 'sensor.kitchen_temp', state: '21.5', attributes: { friendly_name: 'Kitchen temperature', unit_of_measurement: '°C', device_class: 'temperature' } },
  { entity_id: 'lock.front', state: 'locked', attributes: { friendly_name: 'Front door' } },
  { entity_id: 'camera.door', state: 'idle', attributes: { friendly_name: 'Door camera', access_token: 'CAMTOKEN', entity_picture: '/api/camera_proxy/camera.door?token=CAMTOKEN' } },
  { entity_id: 'switch.hidden', state: 'on', attributes: { friendly_name: 'Hidden' } },
  { entity_id: 'automation.night', state: 'on', attributes: { friendly_name: 'Night' } },
];

let server, origin;
test.before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/api/camera_proxy/camera.door') { ha.cameraAuth = req.headers.authorization; res.setHeader('Content-Type', 'image/jpeg'); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); }
    res.statusCode = 404; res.end();
  });
  const wss = new WebSocketServer({ server, path: '/api/websocket' });
  wss.on('connection', ws => {
    ha.connects++;
    ha.sockets.add(ws);
    ws.on('close', () => ha.sockets.delete(ws));
    const send = o => ws.send(JSON.stringify(o));
    send({ type: 'auth_required', ha_version: '2026.10.0' });
    ws.on('message', raw => {
      const m = JSON.parse(String(raw));
      if (m.type === 'auth') return m.access_token === TOKEN ? send({ type: 'auth_ok', ha_version: '2026.10.0' }) : send({ type: 'auth_invalid', message: 'Invalid access token or password' });
      const ok = result => send({ id: m.id, type: 'result', success: true, result });
      if (m.type === 'get_states') return ok(STATES);
      if (m.type === 'get_config') return ok({ location_name: 'Test House', unit_system: { temperature: '°C' } });
      if (m.type === 'config/area_registry/list') return ok([{ area_id: 'kitchen', name: 'Kitchen' }, { area_id: 'hall', name: 'Hall' }]);
      if (m.type === 'config/device_registry/list') return ok([{ id: 'dev1', area_id: 'kitchen' }]);
      if (m.type === 'config/entity_registry/list') return ok([{ entity_id: 'light.kitchen', area_id: 'kitchen' }, { entity_id: 'sensor.kitchen_temp', device_id: 'dev1' },
        { entity_id: 'lock.front', area_id: 'hall' }, { entity_id: 'switch.hidden', hidden_by: 'user' }]);
      if (m.type === 'subscribe_events') { ws.sub = ws.sub || m.id; return ok(null); }
      if (m.type === 'call_service') { ha.calls.push(m); return ok({ context: {} }); }
      send({ id: m.id, type: 'result', success: false, error: { code: 'unknown_command', message: 'Unknown command.' } });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  await H.start();
});
test.after(async () => { require('../modules/home').close(); for (const s of ha.sockets) s.terminate(); await H.stop(); server.close(); });

const keys = () => require('../modules/service-keys');
function changed(entity_id, state, attributes = {}) {
  const s = [...ha.sockets][0];
  s.send(JSON.stringify({ id: s.sub, type: 'event', event: { event_type: 'state_changed', data: { entity_id, new_state: { entity_id, state, attributes } } } }));
}

/** The live stream as a page opens it: resolves its screen, and collects `home` changes. */
async function liveStream(cookie) {
  const ctrl = new AbortController();
  const got = [];
  const res = await fetch(`${H.base}/api/live/stream`, { headers: { Cookie: cookie }, signal: ctrl.signal });
  const reader = res.body.getReader();
  let buf = '', screen = null, wake = null;
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += Buffer.from(value).toString();
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!line.startsWith('data:')) continue;
          const o = JSON.parse(line.slice(5));
          if (o.hello) screen = o.screen; else if (o.topic === 'home') got.push(o);
          wake?.();
        }
      }
    } catch { /* closed */ }
  })();
  const until = async (pred, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await new Promise(r => { wake = r; setTimeout(r, 50); }); } return false; };
  await until(() => screen);
  return { screen, got, until, close: () => ctrl.abort() };
}

test('without the key, the page says how to connect Home Assistant', async () => {
  const r = await H.api(null, 'GET', '/api/home');
  assert.equal(r.status, 200);
  assert.equal(r.body.connected, false);
  assert.equal(r.body.setup.key, 'home-assistant');
});

test('with the key: areas from the registries, tiles only of what a tile needs, the token never in the answer', async () => {
  keys().save({ name: 'home-assistant', origin, key: TOKEN, note: 'Home Assistant' });
  const r = await H.api(null, 'GET', '/api/home');
  assert.equal(r.body.connected, true, r.body.error);
  assert.equal(r.body.place, 'Test House');
  const names = r.body.areas.map(a => a.name);
  assert.deepEqual(names, ['Hall', 'Kitchen', 'Elsewhere'], 'areas by name, things in no area last');
  const kitchen = r.body.areas.find(a => a.name === 'Kitchen').tiles.map(t => t.id);
  assert.deepEqual(kitchen, ['light.kitchen', 'sensor.kitchen_temp'], 'an entity\'s area, or its device\'s');
  const all = r.body.areas.flatMap(a => a.tiles.map(t => t.id));
  assert.ok(!all.includes('switch.hidden'), 'hidden in HA stays hidden');
  assert.ok(!all.includes('automation.night'), 'a kind the page does not draw');
  const text = JSON.stringify(r.body);
  for (const secret of [TOKEN, 'CAMTOKEN', 'SECRET']) assert.ok(!text.includes(secret), `${secret} reached the browser`);
});

test('a change in HA reaches a page holding Home, as the entity\'s new tile', async () => {
  const s = await liveStream(H.owner.cookie);
  const held = await H.api(null, 'POST', '/api/home/hold', { screen: s.screen, on: true });
  assert.equal(held.body.holding, true);
  changed('light.kitchen', 'on', { friendly_name: 'Kitchen light', brightness: 128 });
  assert.ok(await s.until(() => s.got.some(c => c.what === 'state' && c.id === 'light.kitchen')), 'the change arrived');
  const c = s.got.find(x => x.id === 'light.kitchen');
  assert.equal(c.tile.state, 'on');
  assert.equal(c.tile.attrs.brightness, 128);
  assert.equal((await H.api(null, 'POST', '/api/home/hold', { screen: 'not-mine', on: true })).status, 404);
  s.close();
});

test('acting: a short list of services, one entity, only the data each takes', async () => {
  const r = await H.api(null, 'POST', '/api/home/call', { domain: 'light', service: 'turn_on', entity_id: 'light.kitchen', data: { brightness_pct: 40 } });
  assert.equal(r.status, 200, r.body.error);
  const m = ha.calls.at(-1);
  assert.deepEqual({ domain: m.domain, service: m.service, service_data: m.service_data, target: m.target },
    { domain: 'light', service: 'turn_on', service_data: { brightness_pct: 40 }, target: { entity_id: 'light.kitchen' } });
  const refused = async (body, status, re) => { const x = await H.api(null, 'POST', '/api/home/call', body); assert.equal(x.status, status, JSON.stringify(x.body)); assert.match(x.body.error, re); };
  await refused({ domain: 'homeassistant', service: 'restart', entity_id: 'homeassistant.x' }, 400, /does not act on homeassistant/);
  await refused({ domain: 'light', service: 'turn_on', entity_id: 'light.kitchen', data: { flash: 'long' } }, 400, /not flash/);
  await refused({ domain: 'light', service: 'turn_on', entity_id: 'light.kitchen', data: { brightness_pct: 400 } }, 400, /out of range/);
  await refused({ domain: 'light', service: 'turn_on', entity_id: 'switch.hidden' }, 400, /one light/);
  await refused({ domain: 'switch', service: 'turn_off', entity_id: 'switch.hidden' }, 404, /no switch.hidden/);
  await refused({ domain: 'light', service: 'turn_on', entity_id: 'light.cellar' }, 404, /no light.cellar/);
  const before = ha.calls.length;
  await refused({ domain: 'light', service: 'constructor', entity_id: 'light.kitchen' }, 400, /from here/);
  assert.equal(ha.calls.length, before, 'nothing refused reached HA');
});

test('unlocking asks for the password; locking does not', async () => {
  const no = await H.api(null, 'POST', '/api/home/call', { domain: 'lock', service: 'unlock', entity_id: 'lock.front' }, { 'X-Doca-Password': '' });
  assert.equal(no.status, 401);
  assert.equal(no.body.code, 'password_required');
  assert.equal((await H.api(null, 'POST', '/api/home/call', { domain: 'lock', service: 'unlock', entity_id: 'lock.front' })).status, 200, 'with the password');
  assert.equal((await H.api(null, 'POST', '/api/home/call', { domain: 'lock', service: 'lock', entity_id: 'lock.front' }, { 'X-Doca-Password': '' })).status, 200);
});

test('who: a viewer sees but does not act; a level that lists lights sees and uses only lights', async () => {
  const viewer = await H.signIn('viewer');
  assert.equal((await H.api(null, 'GET', '/api/home', undefined, { Cookie: viewer.cookie })).status, 200);
  assert.equal((await H.api(null, 'POST', '/api/home/call', { domain: 'light', service: 'toggle', entity_id: 'light.kitchen' }, { Cookie: viewer.cookie })).status, 403);
  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'POST', '/api/home/call', { domain: 'light', service: 'toggle', entity_id: 'light.kitchen' }, { Cookie: member.cookie })).status, 200, 'the hive\'s home is a member\'s to use');
  const level = require('../modules/auth/levels').create({ name: 'Lights only', rights: ['read', 'chat'], resources: { home: ['light.*'] } }, { actorLevel: 'owner' });
  const lit = await H.signIn(level.id);
  const seen = (await H.api(null, 'GET', '/api/home', undefined, { Cookie: lit.cookie })).body.areas.flatMap(a => a.tiles.map(t => t.id));
  assert.deepEqual(seen, ['light.kitchen']);
  const x = await H.api(null, 'POST', '/api/home/call', { domain: 'lock', service: 'lock', entity_id: 'lock.front' }, { Cookie: lit.cookie });
  assert.equal(x.status, 403);
  assert.match(x.body.error, /not allotted/);
  const home = require('../modules/home');
  assert.equal(home.hears('nobody', lit.user, 'light.kitchen'), false, 'only a screen holding the page hears');
});

test('a camera\'s still comes through the hub, which sends the token; the browser never has it', async () => {
  const r = await H.api(null, 'GET', '/api/home/camera/camera.door');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal(ha.cameraAuth, `Bearer ${TOKEN}`);
  assert.equal((await H.api(null, 'GET', '/api/home/camera/camera.nope')).status, 404);
  assert.equal((await H.api(null, 'GET', '/api/home/camera/light.kitchen')).status, 404);
});

test('nobody looking for a minute closes the connection; a refused token says how to fix it', async () => {
  const home = require('../modules/home');
  home._state.holders.clear();
  home._state.lastUse = 0;
  home.sweep();
  assert.equal(home._state.link, null);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(ha.sockets.size, 0, 'the socket to HA closed');
  keys().save({ name: 'home-assistant', origin, key: 'wrong-token' });
  const r = await H.api(null, 'GET', '/api/home');
  assert.equal(r.body.connected, false);
  assert.match(r.body.error, /refused the token.*Keys for services/);
  assert.ok(!JSON.stringify(r.body).includes('wrong-token'));
});
