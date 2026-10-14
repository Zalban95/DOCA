'use strict';

/**
 * Networks, named once (modules/nearby/networks.js; asked 2026-10-14): a looker's reading is one record, two Wi-Fis with
 * the same addresses stay two when their names differ, a person names a customer's Wi-Fi, and the Cast list says which
 * network each TV was seen on and whether any of the person's devices is there now.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

before(() => H.start());
after(() => H.stop());

test('one network per place, the Wi-Fi name tells two with the same addresses apart, and it can be named', () => {
  const nets = require('../modules/nearby/networks');
  const office = nets.remember({ subnet: '192.168.1.0/24', gateway: '192.168.1.1', ssid: 'Rossi-Guest' }, 'dev_phone');
  assert.match(office.id, /^net_[0-9a-f]{12}$/);
  assert.equal(office.label, 'Rossi-Guest', 'named after its Wi-Fi until a person names it');
  const other = nets.remember({ subnet: '192.168.1.0/24', gateway: '192.168.1.1', ssid: 'Bianchi' }, 'dev_phone');
  assert.notEqual(other.id, office.id, 'same addresses, another Wi-Fi: another network');
  assert.equal(nets.remember({ subnet: '192.168.1.0/24', gateway: '192.168.1.1', ssid: 'Rossi-Guest' }, 'dev_phone').id, office.id);
  assert.equal(nets.whereNow('dev_phone'), office.id, 'where the phone said it is now');
  assert.equal(nets.remember({ subnet: null }, 'dev_phone'), null, 'mobile data: nothing to know it by');
  const home = nets.remember({ subnet: '10.0.0.0/24', gateway: '10.0.0.1', gatewayMacHash: 'abcdef123456' }, 'hub');
  assert.equal(home.label, 'Network 10.0.0.0/24');
  assert.equal(nets.rename(office.id, "Rossi's office").label, "Rossi's office");
  assert.equal(nets.remember({ subnet: '192.168.1.0/24', gateway: '192.168.1.1', ssid: 'Rossi-Guest' }, 'dev_phone').label, "Rossi's office", 'a name a person gave stays');
  assert.throws(() => nets.rename('net_nope', 'x'), /No network/);
});

test('the Cast list carries the network a TV was saved on, and whether any of the person\'s devices is there now', async () => {
  const nets = require('../modules/nearby/networks');
  const office = nets.remember({ subnet: '192.168.7.0/24', gateway: '192.168.7.1', ssid: 'Customer' }, 'dev_x');
  require('../modules/store').writeJson('nearby/things', { things: [{ id: 'n_tv1', name: 'Meeting room TV', place: 'Customer', room: '', kind: 'tv',
    keys: ['cast:abc'], addresses: ['192.168.7.20'], can: ['cast'], how: { cast: { ip: '192.168.7.20', port: 8009 } }, network: office.id }] });
  const things = require('../modules/cast/things');
  const who = { user: H.owner.user || { id: H.owner.id }, role: 'owner' };
  const away = things.list(who, { hub: null }).find(t => t.id === 'n_tv1');
  assert.deepEqual(away.network, { id: office.id, label: 'Customer' });
  assert.equal(away.here, false, 'none of the person\'s devices is on that network now');
  assert.equal(things.list(who, { dev_x: office.id }).find(t => t.id === 'n_tv1').here, true);
  // Named from the panel; the sheet's route says where each looker is.
  const r = await H.api(null, 'POST', `/api/machines/nearby/networks/${office.id}`, { label: "Rossi's office" });
  assert.equal(r.status, 200);
  const list = await H.api(null, 'GET', '/api/machines/nearby/networks');
  assert.ok(list.body.networks.some(n => n.label === "Rossi's office"));
  const sheet = await H.api(null, 'GET', '/api/cast/things');
  assert.equal(sheet.status, 200);
  assert.ok(Array.isArray(sheet.body.here));
  assert.equal(sheet.body.things.find(t => t.id === 'n_tv1')?.network?.label, "Rossi's office");
});
