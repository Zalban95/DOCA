'use strict';

/** Who can reach the hub, and what may be done from outside the tailnet (modules/listen.js, modules/network.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const listen = require('../modules/listen');
const network = require('../modules/network');

test.before(() => H.start());
test.after(() => H.stop());

test('lan: the tailnet and the local network, both ends private; never the internet', () => {
  assert.equal(listen.allowed('lan', '192.168.1.10', '192.168.1.42'), true, 'a phone on the Wi-Fi');
  assert.equal(listen.allowed('lan', '10.0.0.5', '::ffff:10.0.0.9'), true);
  assert.equal(listen.allowed('lan', '100.101.1.2', '100.80.3.4'), true, 'the tailnet as before');
  assert.equal(listen.allowed('lan', '192.168.1.10', '8.8.8.8'), false, 'a public address that reached the LAN interface');
  assert.equal(listen.allowed('tailnet', '192.168.1.10', '192.168.1.42'), false, 'the default does not take the LAN');
  assert.equal(listen.isPrivate('172.20.0.1'), true);
  assert.equal(listen.isPrivate('172.32.0.1'), false);
  assert.equal(listen.isPrivate('fd12:3456::1'), true);
});

test('from outside the tailnet the machine\'s rights are refused unless the admin allows them', async () => {
  const lan = { socket: { remoteAddress: '::ffff:192.168.1.42' } }, tail = { socket: { remoteAddress: '100.90.1.2' } };
  assert.equal(network.limited(lan, 'host'), true);
  assert.equal(network.limited(lan, 'chat'), false, 'chat from the Wi-Fi is fine');
  assert.equal(network.limited(tail, 'host'), false);
  assert.deepEqual(network.rightsFrom(lan, ['read', 'chat', 'host', 'users']), ['read', 'chat']);
  let r = await H.api(null, 'POST', '/api/network', { listen: 'lan', lanAdmin: true });
  assert.equal(r.body.saved, 'lan'); assert.equal(r.body.restartNeeded, true);
  assert.equal(network.limited(lan, 'host'), false, 'allowed now');
  assert.equal((await H.api(null, 'POST', '/api/network', { listen: 'everywhere' })).status, 400);
  await H.api(null, 'POST', '/api/network', { listen: 'tailnet', lanAdmin: false });
  r = await H.api(null, 'GET', '/api/hub/links');
  assert.ok(Array.isArray(r.body.links));
  const member = await H.signIn('member', 'net-member@test.local');
  assert.equal((await H.api(null, 'POST', '/api/network', { listen: 'all' }, { Cookie: member.cookie })).status, 403);
});
