'use strict';

/**
 * Nearby, looked at from a client (R3f; PROTOCOL §22.5; nearby/lookers.js): only the person's own connected devices
 * lending nearby_scan are offered; a client's sightings merge like the hub's and remember who saw them; on another
 * network its private addresses stay its own; doca-client's family answers in the hub's shape.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const net    = require('node:net');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

const reg = () => require('../modules/mcp/registry');
const devices = () => require('../modules/api-v1/devices');

/** A stand-in client: a running MCP server of device `dev` that answers nearby_scan with `answer`. */
let originals = null;
function standIn(t, { dev, userId, answer, tools = ['nearby_scan', 'nearby_network'] }) {
  const r = reg(), d = devices();
  if (!originals) originals = { list: r.list, client: r.client, get: d.get };
  const list = r.list, client = r.client, get = d.get;
  r.list = () => [...list(), { id: `client-${dev}`, origin: { kind: 'client', deviceId: dev }, state: 'running', tools: tools.map(name => ({ name })) }];
  r.client = id => (id === `client-${dev}` ? { callTool: async (name, args) => JSON.stringify(answer(name, args)) } : client(id));
  d.get = id => (id === dev ? { id: dev, name: 'Desk at home', userId } : get(id));
  t.after(() => { r.list = originals.list; r.client = originals.client; d.get = originals.get; });   // whole: after-hooks run first to last
}

const sighting = (ip, extra = {}) => ({ source: 'cast', name: 'Living room TV', keys: [`cast:abc123`, `ip:${ip}`], addresses: [ip], kinds: [{ kind: 'tv', w: 9 }], can: ['cast'], how: { cast: { ip, port: 8009 } }, ...extra });

test('only the person\'s own connected devices lending Nearby are offered', t => {
  standIn(t, { dev: 'd_mine', userId: H.owner.user.id, answer: () => ({}) });
  standIn(t, { dev: 'd_theirs', userId: 'someone-else', answer: () => ({}) });
  const list = require('../modules/nearby/lookers').list({ id: H.owner.user.id });
  assert.deepEqual(list.map(l => l.id), ['hub', 'client-d_mine']);
});

test('a client on another network: its things merge, keep who saw them, and private addresses stay its own', async t => {
  standIn(t, { dev: 'd_desk', userId: H.owner.user.id, answer: () => ({ things: [sighting('192.168.1.40'), { source: 'lan', name: 'printer', keys: ['ip:192.168.1.41'], addresses: ['192.168.1.41'], kinds: [] }],
    sources: ['cast', 'lan'], network: { subnet: '192.168.1.0/24', gateway: '192.168.1.1', gatewayMacHash: 'elsewhere123' }, why: { bluetooth: 'no adapter' } }) });
  const r = await H.api(null, 'POST', '/api/machines/nearby/scan', { from: 'client-d_desk' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.from, 'Desk at home');
  assert.equal(r.body.sameNetwork, false);
  const tv = r.body.seen.find(x => x.name === 'Living room TV');
  assert.ok(tv.keys.includes('ip:192.168.1.40@d_desk'), 'its private address is keyed to where it was seen');
  assert.ok(tv.keys.includes('cast:abc123'), 'a strong key is the same everywhere');
  assert.equal(tv.seenFrom[0].by, 'd_desk');
  assert.equal(tv.seenFrom[0].label, 'Desk at home');
  assert.match(require('../modules/nearby/describe').line(tv), /from Desk at home just now/);
  const lines = await require('../modules/activity').lines?.({ from: 'nearby' });
  if (lines) assert.ok(lines.some(l => /from Desk at home/.test(l.what)));
});

test('another person\'s device, or one that is gone, cannot be looked from', async t => {
  standIn(t, { dev: 'd_other', userId: 'someone-else', answer: () => ({ things: [] }) });
  const r = await H.api(null, 'POST', '/api/machines/nearby/scan', { from: 'client-d_other' });
  assert.equal(r.status, 404);
  assert.match(r.body.error, /not one of yours/);
});

test('the agent scans from a device by its name, and is told which ones can when none matches', async t => {
  standIn(t, { dev: 'd_desk2', userId: H.owner.user.id, answer: () => ({ things: [sighting('10.0.0.9', { keys: ['cast:zzz', 'ip:10.0.0.9'] })], sources: ['cast'], network: { gatewayMacHash: 'x' } }) });
  const tool = require('../modules/harness/toolbox/nearby')[0];
  const ctx = { user: { id: H.owner.user.id, name: 'Owner', role: 'owner' } };
  assert.match(await tool.run({ action: 'scan', from: 'desk at home' }, ctx), /Scanned from Desk at home .*: 1 found/);
  assert.match(await tool.run({ action: 'scan', from: 'kitchen tablet' }, ctx), /Ones that do: Desk at home/);
});

test('one network is one network: the same gateway card, else the same subnet and gateway', () => {
  const { sameNetwork, hashMac } = require('../modules/nearby/network');
  assert.equal(hashMac('AA:BB:CC:DD:EE:FF'), hashMac('aa:bb:cc:dd:ee:ff'));
  assert.ok(sameNetwork({ gatewayMacHash: 'a' }, { gatewayMacHash: 'a', subnet: 'x' }));
  assert.ok(!sameNetwork({ gatewayMacHash: 'a' }, { gatewayMacHash: 'b' }));
  assert.ok(sameNetwork({ subnet: '192.168.1.0/24', gateway: '192.168.1.1' }, { subnet: '192.168.1.0/24', gateway: '192.168.1.1' }));
  assert.ok(!sameNetwork(null, { gatewayMacHash: 'a' }));
});

test('doca-client\'s family: a probe connects and sends nothing; a scan answers in the hub\'s shape', async () => {
  const nearby = require('../clients/node/nearby');
  let got = '';
  const srv = net.createServer(s => s.on('data', d => { got += d; })).listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  assert.equal((await nearby.TOOLS.nearby_probe.run(null, { address: '127.0.0.1', port: srv.address().port })).open, true);
  await new Promise(r => setTimeout(r, 50));
  srv.close();
  assert.equal(got, '', 'nothing was sent');
  assert.equal((await nearby.TOOLS.nearby_probe.run(null, { address: '127.0.0.1', port: 1 })).open, false);
  const r = await nearby.scan({ sources: ['lan'] });
  assert.deepEqual(r.sources, ['lan']);
  assert.ok(Array.isArray(r.things) && r.things.every(x => x.source === 'lan' && Array.isArray(x.keys)));
  assert.ok('gatewayMacHash' in r.network && !JSON.stringify(r.network).match(/([0-9a-f]{2}:){5}/i), 'the gateway by a hash, never its MAC');
  assert.deepEqual(Object.keys(nearby.TOOLS), require('../modules/api-v1/families').CANONICAL.nearby);
});

test('a client\'s nearby and cast answers are kept, and can be withdrawn from the panel', () => {
  const dc = require('../modules/devices-control');
  const s = dc.reportGrants('d_grants', { nearby: true, cast: true, files: false });
  assert.ok(s.usable.includes('nearby') && s.usable.includes('cast'), JSON.stringify(s));
  assert.ok(dc.FAMILIES.includes('nearby') && dc.FAMILIES.includes('cast'), 'askable and revocable by name');
});
