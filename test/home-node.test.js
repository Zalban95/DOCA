'use strict';

/**
 * A home node (docs/design/home-node.md, PROTOCOL §22.4): doca-client in the household keeps Home Assistant's token
 * and its WebSocket, and lends `home` over the socket it dials to the hub. Two stub HAs, two nodes — one in this
 * process, one a child process that is killed to go away — paired to a test hub: the page through a node, a change
 * pushed, an allowed call, a refused one (by the hub and by the node itself), the agent narrowed like the page, a
 * node away, two homes.
 */
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const stub = require('./fixtures/ha-stub');

process.env.DOCA_SOCKET_PING_MS = '1000';   // the hub's heartbeat, short: a frozen node is noticed in seconds

const TOKEN_A = 'ha-token-of-the-flat-123', TOKEN_B = 'ha-token-of-the-sea-house-456';
let haA, haB, dir, client, nodeA, ctrl, childB = null;
const ids = {}, said = [];

const STATES_A = [
  { entity_id: 'light.kitchen', state: 'off', attributes: { friendly_name: 'Kitchen light', supported_color_modes: ['brightness'], entity_picture: '/api/x?token=SECRET' } },
  { entity_id: 'lock.front', state: 'locked', attributes: { friendly_name: 'Front door' } },
  { entity_id: 'camera.door', state: 'idle', attributes: { friendly_name: 'Door camera', access_token: 'CAMTOKEN' } },
];
const STATES_B = [{ entity_id: 'light.terrace', state: 'on', attributes: { friendly_name: 'Terrace' } }, { entity_id: 'switch.pump', state: 'off', attributes: { friendly_name: 'Pump' } }];
const until = async (fn, ms = 8000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timed out'); await H.sleep(50); } };
const asDir = d => { process.env.DOCA_CLIENT_DIR = d; };

/** Pairs a node from the panel's code, keeps HA's address and token in its own config. */
async function pairNode(name, sub, ha, token) {
  asDir(path.join(dir, sub));
  const code = await H.api(null, 'POST', '/api/devices/pair', { name, preset: 'phone' });
  assert.equal(code.status, 201, JSON.stringify(code.body));
  const cfg = await client.pair(H.base, code.body.code, { name });
  return { cfg, deviceId: cfg.deviceId, ha, token, dir: path.join(dir, sub) };
}

async function accept(deviceId) {
  const offer = await until(async () => ((await H.api(null, 'GET', '/api/mcp')).body.offers || []).find(o => o.deviceId === deviceId));
  assert.equal(offer.transport, 'socket', 'a node offers its own socket: nothing at home is reachable');
  const acc = await H.api(null, 'POST', `/api/mcp/offers/${offer.id}/accept`);
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  const reg = require('../modules/mcp/registry');
  await until(() => reg.client(reg.forDevice(deviceId).id)?.state === 'running');
  return reg.forDevice(deviceId).id;
}

function startChild(node) {
  childB = spawn(process.execPath, [path.join(__dirname, '..', 'clients', 'node', 'doca-client.js'), 'run', '--grant', 'home'],
    { env: { ...process.env, DOCA_CLIENT_DIR: node.dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  childB.stdout.on('data', d => said.push(String(d))); childB.stderr.on('data', d => said.push(String(d)));
}

test.before(async () => {
  haA = await stub.start({ token: TOKEN_A, place: 'The flat', states: STATES_A, areas: [{ area_id: 'kitchen', name: 'Kitchen' }], entities: [{ entity_id: 'light.kitchen', area_id: 'kitchen' }] });
  haB = await stub.start({ token: TOKEN_B, place: 'The sea house', states: STATES_B });
  await H.start();
  require('../modules/terminal').setup(H.server());   // routes /api/v1/mcp/host
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-node-'));
  client = require('../clients/node/doca-client');
  ctrl = new AbortController();
});
test.after(async () => {
  ctrl.abort();
  if (childB && childB.exitCode === null) childB.kill();
  await nodeA?.stop();
  haA.close(); haB.close();
  await H.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a node keeps HA\'s token itself, dials the hub, and the Home page draws the home through it', async () => {
  const a = await pairNode('Flat node', 'a', haA, TOKEN_A);
  const b = await pairNode('Sea house', 'b', haB, TOKEN_B);
  // home setup, as a person answers it at that machine
  asDir(a.dir);
  const answers = [haA.origin, TOKEN_A];
  await require('../clients/node/home').setup(client.load(), { ask: async () => answers.shift(), save: client.save, log: m => said.push(m) });
  const cfgA = client.load();
  assert.equal(cfgA.home.token, TOKEN_A);
  assert.equal(cfgA.transport, 'socket');
  if (process.platform !== 'win32') assert.equal(fs.statSync(client.configFile()).mode & 0o777, 0o600, 'the token file is the node\'s owner\'s alone');
  nodeA = await client.run({ grant: ['home'], signal: ctrl.signal, log: m => said.push(m) });
  assert.match(said.join('\n'), /over its own connection to the hub/);
  ids.a = await accept(a.deviceId);
  // node B is a process of its own
  asDir(b.dir);
  const cfgB = client.load(); cfgB.home = { url: haB.origin, token: TOKEN_B }; cfgB.transport = 'socket'; client.save(cfgB);
  startChild(b);
  ids.b = await accept(b.deviceId);
  Object.assign(ids, { devA: a.deviceId, devB: b.deviceId });
  asDir(a.dir);   // the node running in this process saves its own config

  const r = await H.api(null, 'GET', '/api/home');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.homes.map(h => [h.id, h.kind, h.online]), [['flat-node', 'node', true], ['sea-house', 'node', true]], 'no key on the hub: the homes are the nodes');
  assert.equal(r.body.home, 'flat-node');
  assert.equal(r.body.place, 'The flat');
  assert.deepEqual(r.body.areas.map(x => x.name), ['Kitchen', 'Elsewhere']);
  const text = JSON.stringify(r.body);
  for (const secret of [TOKEN_A, 'CAMTOKEN', 'SECRET']) assert.ok(!text.includes(secret), `${secret} reached the browser`);
  // The token is nowhere on the hub: not in its data folder, not in its settings.
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(process.env.DOCA_DATA_DIR).concat(fs.existsSync(process.env.DOCA_PREFS_FILE || '') ? [process.env.DOCA_PREFS_FILE] : []))
    assert.ok(!fs.readFileSync(f).includes(TOKEN_A) && !fs.readFileSync(f).includes(TOKEN_B), `a home's token in ${f}`);
  const b2 = await H.api(null, 'GET', '/api/home?home=sea-house');
  assert.equal(b2.body.place, 'The sea house');
  assert.deepEqual(b2.body.areas.flatMap(x => x.tiles.map(t => t.id)).sort(), ['light.terrace', 'switch.pump']);
});

test('a change in the house is pushed up by the node and reaches a page holding Home, with its home', async () => {
  const ctrlS = new AbortController(), got = [];
  const res = await fetch(`${H.base}/api/live/stream`, { headers: { Cookie: H.owner.cookie }, signal: ctrlS.signal });
  const reader = res.body.getReader();
  let buf = '', screen = null;
  (async () => { try { for (;;) { const { done, value } = await reader.read(); if (done) break; buf += Buffer.from(value).toString(); let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); if (!l.startsWith('data:')) continue; const o = JSON.parse(l.slice(5)); if (o.hello) screen = o.screen; else if (o.topic === 'home') got.push(o); } } } catch { /* closed */ } })();
  await until(() => screen);
  assert.equal((await H.api(null, 'POST', '/api/home/hold', { screen, on: true })).body.holding, true);
  haA.changed('light.kitchen', 'on', { friendly_name: 'Kitchen light', brightness: 128, entity_picture: '/x?token=SECRET' });
  const c = await until(() => got.find(x => x.what === 'state' && x.id === 'light.kitchen'));
  assert.equal(c.home, 'flat-node');
  assert.equal(c.tile.state, 'on');
  assert.equal(c.tile.attrs.brightness, 128);
  assert.ok(!JSON.stringify(c).includes('SECRET'));
  ctrlS.abort();
});

test('acting: an allowed call reaches HA through the node; one off the list is refused by the hub and by the node itself', async () => {
  const r = await H.api(null, 'POST', '/api/home/call', { home: 'flat-node', domain: 'light', service: 'turn_on', entity_id: 'light.kitchen', data: { brightness_pct: 40 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = haA.calls.at(-1);
  assert.deepEqual([m.domain, m.service, m.service_data, m.target], ['light', 'turn_on', { brightness_pct: 40 }, { entity_id: 'light.kitchen' }]);
  const before = haA.calls.length;
  const no = await H.api(null, 'POST', '/api/home/call', { home: 'flat-node', domain: 'homeassistant', service: 'restart', entity_id: 'homeassistant.x' });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /does not act on homeassistant/);
  // The node holds the same list: a request that never passed the hub's check is refused there too.
  const reg = require('../modules/mcp/registry');
  const raw = await reg.client(ids.a).request('tools/call', { name: 'home_call', arguments: { domain: 'light', service: 'turn_on', entity_id: 'light.kitchen', data: { flash: 'long' } } });
  assert.equal(raw.isError, true);
  assert.match(raw.content[0].text, /not flash/);
  assert.equal(haA.calls.length, before, 'nothing refused reached HA');
  const shot = await H.api(null, 'GET', '/api/home/camera/camera.door?home=flat-node');
  assert.equal(shot.status, 200);
  assert.equal(haA.cameraAuth, `Bearer ${TOKEN_A}`, 'the node fetched the picture with its own token');
  const unlock = await H.api(null, 'POST', '/api/home/call', { home: 'flat-node', domain: 'lock', service: 'unlock', entity_id: 'lock.front' }, { 'X-Doca-Password': '' });
  assert.equal(unlock.status, 401, 'unlocking through a node asks for the password as well');
});

test('the agent uses a node as the page does: narrowed to its person, an unlock always asked', async () => {
  const tools = require('../modules/harness/tools');
  const level = require('../modules/auth/levels').create({ name: 'Sea lights', rights: ['read', 'chat'], resources: { home: ['sea-house/light.*'] } }, { actorLevel: 'owner' });
  const s = await H.signIn(level.id), p = { user: { ...s.user, role: level.id } };   // a turn's person carries the role
  const seen = JSON.parse(await tools.call(`mcp__${ids.b}__home_states`, {}, [], { user: p.user }));
  assert.deepEqual(seen.areas.flatMap(a => a.tiles.map(t => t.id)), ['light.terrace'], 'only what the level names, in that home');
  const flat = JSON.parse(await tools.call(`mcp__${ids.a}__home_states`, {}, [], { user: p.user }));
  assert.deepEqual(flat.areas, [], 'nothing of the other home');
  assert.match(await tools.call(`mcp__${ids.b}__home_call`, { domain: 'switch', service: 'turn_on', entity_id: 'switch.pump' }, [], { user: p.user }), /not allotted/);
  const ok = await tools.call(`mcp__${ids.b}__home_call`, { domain: 'light', service: 'turn_off', entity_id: 'light.terrace' }, [], { user: p.user });
  assert.match(ok, /"ok":true/);
  assert.equal(haB.calls.at(-1).service, 'turn_off');
  const g = require('../modules/harness/approval').gate(`mcp__${ids.a}__home_call`, { domain: 'lock', service: 'unlock', entity_id: 'lock.front' });
  assert.equal(g.forced, true);
  assert.equal(g.keys, null, 'never "always"');
});

test('a node that goes away: the page shows what it last said, greyed and dated; acting is refused with a sentence; it comes back', async () => {
  const nodes = require('../modules/home/nodes');
  // Frozen rather than closed where the OS can (a node that lost power or its network: no close ever arrives) — the
  // hub's heartbeat has to notice it. Windows has no SIGSTOP: there the process is ended.
  const frozen = process.platform !== 'win32';
  childB.kill(frozen ? 'SIGSTOP' : 'SIGTERM');
  await until(() => !nodes.online(ids.devB), 15000);
  const r = await H.api(null, 'GET', '/api/home?home=sea-house');
  assert.equal(r.body.offline, true);
  assert.equal(r.body.connected, false);
  assert.ok(r.body.seen, 'when it was last seen');
  assert.match(r.body.error, /away/);
  assert.deepEqual(r.body.areas.flatMap(a => a.tiles.map(t => t.id)).sort(), ['light.terrace', 'switch.pump'], 'what it last said');
  assert.equal(r.body.homes.find(h => h.id === 'sea-house').online, false);
  const call = await H.api(null, 'POST', '/api/home/call', { home: 'sea-house', domain: 'switch', service: 'turn_on', entity_id: 'switch.pump' });
  assert.equal(call.status, 409);
  assert.equal(call.body.code, 'node_away');
  assert.match(call.body.error, /away.*nothing can be done/);
  const exited = new Promise(res => childB.once('exit', res));
  childB.kill('SIGKILL');
  await exited;
  startChild({ dir: path.join(dir, 'b') });   // it reconnects by itself; here, a restart
  await until(() => nodes.online(ids.devB), 15000);
  // Online is the node's socket; whether it has reached its HA again is its own next word (a status push). Wait for it.
  const back = await until(async () => { const x = await H.api(null, 'GET', '/api/home?home=sea-house'); return x.body.connected === true && x.body; }, 15000);
  assert.ok(!back.offline);
  assert.equal(back.place, 'The sea house');
});

test('home.source: direct alone uses the hub\'s key; both lists every home', async () => {
  const keys = require('../modules/service-keys');
  keys.save({ name: 'home-assistant', origin: haA.origin, key: TOKEN_A, note: 'HA' });
  const { savePrefs, loadPrefs } = require('../modules/utils');
  const setSource = v => savePrefs({ ...loadPrefs(), home: { source: v } });
  try {
    assert.deepEqual((await H.api(null, 'GET', '/api/home')).body.homes.map(h => h.id), ['flat-node', 'sea-house'], 'auto: the nodes, even with a key');
    setSource('both');
    assert.deepEqual((await H.api(null, 'GET', '/api/home')).body.homes.map(h => h.id), ['hub', 'flat-node', 'sea-house']);
    setSource('direct');
    const d = await H.api(null, 'GET', '/api/home');
    assert.deepEqual(d.body.homes.map(h => h.id), ['hub']);
    assert.equal(d.body.place, 'The flat');
  } finally { setSource('auto'); require('../modules/home').close(); keys.remove?.('home-assistant'); }
});
