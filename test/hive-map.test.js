'use strict';

// Draw my hive (machines/map.js; R16): one picture from the records — a person and their phone, the phone hosting an MCP
// server, a speaker the phone saw, the hub — with a link for each relation a record names. Host-only, like /api/machines.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

test.before(() => H.start());
test.after(() => H.stop());

test('the hive as nodes in columns, each link from a record; a member is not shown it', async () => {
  const devices = require('../modules/api-v1/devices');
  const made = devices.create({ name: 'Al phone', scopes: ['harness:chat'], caps: H.PHONE_CAPS, kind: 'device' });
  devices.update(made.device.id, { userId: H.owner.user.id });
  const reg = require('../modules/mcp/registry'), list = reg.list;
  reg.list = () => [...list(), { id: 'phone-hands', label: 'Phone hands', origin: { kind: 'client', deviceId: made.device.id }, state: 'running', toolCount: 4, tools: [] }];
  const store = require('../modules/nearby/store');
  store.writeSeen([{ id: 's9', name: 'Kitchen speaker', kind: 'speaker', keys: ['cast:k9'], addresses: ['192.168.1.9'], can: ['cast'], how: {}, sources: ['cast'],
    seenFrom: [{ by: made.device.id, label: 'Al phone', at: new Date().toISOString() }], lastSeen: new Date().toISOString() }]);
  store.save({ seenId: 's9', place: 'Home', room: 'Kitchen' });
  try {
    const r = await H.api(null, 'GET', '/api/machines/map');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const { nodes, links, columns } = r.body;
    const id = label => nodes.find(n => n.label === label)?.id;
    assert.equal(nodes.find(n => n.id === 'hub').col, 'hub');
    assert.ok(id('Al phone') && id('Phone hands') && id('Kitchen speaker'));
    const has = (a, b, label) => links.some(l => l.from === a && l.to === b && (label === undefined || l.label === label));
    assert.ok(has(id('Al phone'), 'hub', 'paired'), 'a device is paired to the hub');
    assert.ok(has(`p:${H.owner.user.id}`, id('Al phone')), 'a person to their device');
    assert.ok(has(id('Al phone'), id('Phone hands'), 'hosts'), 'a server on the phone is the phone\'s');
    assert.ok(has(id('Al phone'), id('Kitchen speaker'), 'sees'), 'a thing to who saw it');
    assert.equal(nodes.find(n => n.label === 'Kitchen speaker').detail, 'Home · Kitchen');
    assert.ok(columns.some(c => c.id === 'around') && columns.every(c => nodes.some(n => n.col === c.id)), 'only columns that hold something');
    const member = await H.signIn('member');
    assert.equal((await H.api(null, 'GET', '/api/machines/map', undefined, { Cookie: member.cookie })).status, 403);
  } finally { reg.list = list; }
});
