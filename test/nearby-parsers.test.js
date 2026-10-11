'use strict';

/**
 * Nearby's readers (modules/nearby), with no network: an mDNS response read record by record (name compression,
 * PTR/SRV/TXT/A) and grouped into instances; SSDP answers and a UPnP description; `ip -j neigh`, `arp -a` on macOS
 * and Windows; bluetoothctl's lists and info and pairing's questions; system_profiler's Bluetooth JSON; `tailscale
 * status --json`; `catt scan`; the sightings each makes; and the merge that makes one row per thing. Samples are in the
 * tools' own shapes, with made-up names and addresses.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const mdns = require('../modules/nearby/mdns');
const ssdp = require('../modules/nearby/ssdp');
const lan = require('../modules/nearby/lan');
const oui = require('../modules/nearby/oui');
const bt = require('../modules/nearby/bluetooth');
const others = require('../modules/nearby/others');
const sight = require('../modules/nearby/sightings');
const merge = require('../modules/nearby/merge');

/* ── A tiny DNS writer, for responses in the wire's own shape ── */
const name = n => Buffer.concat([...n.split('.').map(l => { const b = Buffer.from(l); return Buffer.concat([Buffer.from([b.length]), b]); }), Buffer.from([0])]);
function rr(owner, type, data) {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0); head.writeUInt16BE(0x8001, 2); head.writeUInt32BE(120, 4); head.writeUInt16BE(data.length, 8);
  return Buffer.concat([Buffer.isBuffer(owner) ? owner : name(owner), head, data]);
}
const txt = kv => Buffer.concat(Object.entries(kv).map(([k, v]) => { const b = Buffer.from(`${k}=${v}`); return Buffer.concat([Buffer.from([b.length]), b]); }));
function response(records) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0x8400, 2); head.writeUInt16BE(records.length, 6);
  return Buffer.concat([head, ...records]);
}

test('mDNS: a query asks PTR for each name; a response is read with compression and grouped into instances', () => {
  const q = mdns.buildQuery(['_googlecast._tcp.local']);
  assert.equal(q.readUInt16BE(4), 1);
  assert.equal(q.subarray(12, 24).toString('latin1'), '\x0b_googlecast');
  assert.equal(q.readUInt16BE(q.length - 4), 12, 'PTR');

  const inst = 'Nest-Audio-0123abcd0123abcd0123abcd0123abcd._googlecast._tcp.local';
  const ptr = rr('_googlecast._tcp.local', 12, name(inst));
  // The SRV's owner is a compression pointer to the PTR's data (offset 12 header + PTR owner + 10).
  const ptrOwnerLen = name('_googlecast._tcp.local').length;
  const pointer = Buffer.from([0xc0, 12 + ptrOwnerLen + 10]);
  const srvData = Buffer.concat([Buffer.from([0, 0, 0, 0, 0x1f, 0x49]), name('0123abcd.local')]);
  const pkt = response([ptr, rr(pointer, 33, srvData), rr(inst, 16, txt({ id: '0123ABCD', md: 'Nest Audio', fn: 'Study speaker' })), rr('0123abcd.local', 1, Buffer.from([192, 168, 7, 20]))]);
  const recs = mdns.parse(pkt);
  assert.equal(recs.length, 4);
  assert.equal(recs[1].name, inst, 'a pointer is followed');
  assert.deepEqual(recs[1].data, { priority: 0, weight: 0, port: 8009, target: '0123abcd.local' });
  const [one] = mdns.instances([{ buf: pkt, from: '192.168.7.20' }]);
  assert.equal(one.type, '_googlecast._tcp');
  assert.equal(one.txt.fn, 'Study speaker');
  assert.deepEqual(one.addresses, ['192.168.7.20']);
  assert.deepEqual(mdns.parse(Buffer.from([1, 2, 3])), [], 'a short packet is nothing');
  assert.deepEqual(mdns.parse(Buffer.concat([pkt.subarray(0, 40)])), mdns.parse(pkt.subarray(0, 40)), 'a cut packet does not throw');
});

test('mDNS: the service-type list names more types; virtual interfaces are not asked', () => {
  const pkt = response([rr('_services._dns-sd._udp.local', 12, name('_airplay._tcp.local')), rr('_services._dns-sd._udp.local', 12, name('_ipp._tcp.local'))]);
  assert.deepEqual(mdns.typesIn([{ buf: pkt, from: '192.168.7.2' }]), ['_airplay._tcp.local', '_ipp._tcp.local']);
  const ifs = { lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], docker0: [{ family: 'IPv4', address: '172.17.0.1' }],
    wlan0: [{ family: 'IPv4', address: '192.168.7.5' }, { family: 'IPv6', address: 'fe80::1' }], eth0: [{ family: 'IPv4', address: '169.254.3.3' }] };
  assert.deepEqual(mdns.lanAddresses(ifs), ['192.168.7.5']);
});

const DESCRIPTION = `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><URLBase>http://192.168.7.30:1400/</URLBase><device>
  <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>Den TV &amp; Sound</friendlyName>
  <manufacturer>Example Corp</manufacturer><modelName>Screen 55</modelName><UDN>uuid:AAAA-1111</UDN><presentationURL>/web/</presentationURL>
  <serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/MediaRenderer/AVTransport/Control</controlURL></service>
  <service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/rc</controlURL></service></serviceList>
  <deviceList><device><friendlyName>inner</friendlyName></device></deviceList></device></root>`;

test('SSDP: an answer\'s headers, what may be fetched, and a description', () => {
  const h = ssdp.parseResponse('HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: http://192.168.7.30:1400/xml/device_description.xml\r\nST: upnp:rootdevice\r\nUSN: uuid:AAAA-1111::upnp:rootdevice\r\n\r\n');
  assert.equal(h.location, 'http://192.168.7.30:1400/xml/device_description.xml');
  assert.equal(h.st, 'upnp:rootdevice');
  assert.equal(ssdp.parseResponse('M-SEARCH * HTTP/1.1\r\n\r\n'), null, 'another querier is not an answer');
  assert.ok(ssdp.fetchable(h.location));
  assert.ok(!ssdp.fetchable('http://203.0.113.9/desc.xml'), 'a public address is never fetched');
  assert.ok(!ssdp.fetchable('file:///etc/passwd'));
  const d = ssdp.parseDescription(DESCRIPTION, h.location);
  assert.equal(d.friendlyName, 'Den TV & Sound', 'the root device, entities read');
  assert.equal(d.udn, 'uuid:AAAA-1111');
  assert.equal(d.presentationURL, 'http://192.168.7.30:1400/web/');
  assert.equal(d.services[0].control, 'http://192.168.7.30:1400/MediaRenderer/AVTransport/Control');
  const s = sight.upnp({ ...d, from: '192.168.7.30', location: h.location });
  assert.deepEqual(s.can, ['dlna-play', 'web']);
  assert.equal(s.kinds[0].kind, 'tv');
});

test('the LAN: ip -j neigh, arp -a on macOS and Windows, the gateway, makers and private addresses', () => {
  const neigh = JSON.stringify([
    { dst: '192.168.7.1', dev: 'wlan0', lladdr: 'b8:27:eb:00:00:01', state: ['REACHABLE'] },
    { dst: '172.17.0.2', dev: 'docker0', lladdr: '02:42:ac:11:00:02', state: ['STALE'] },
    { dst: '192.168.7.40', dev: 'wlan0', lladdr: '26:aa:bb:cc:dd:ee', state: ['STALE'] },
    { dst: '192.168.7.99', dev: 'wlan0', state: ['FAILED'] },
    { dst: 'fe80::1', dev: 'wlan0', lladdr: 'b8:27:eb:00:00:01', state: ['STALE'] }]);
  assert.deepEqual(lan.parseIpNeigh(neigh).map(r => r.ip), ['192.168.7.1', '192.168.7.40']);
  const mac = lan.parseArp('? (192.168.7.1) at b8:27:eb:0:0:1 on en0 ifscope [ethernet]\n? (192.168.7.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]\n? (192.168.7.8) at (incomplete) on en0 ifscope [ethernet]\n');
  assert.deepEqual(mac, [{ ip: '192.168.7.1', mac: 'b8:27:eb:00:00:01', dev: 'en0' }], 'single digits padded, broadcast and incomplete dropped');
  const win = lan.parseArp('\r\nInterface: 192.168.7.5 --- 0x7\r\n  Internet Address      Physical Address      Type\r\n  192.168.7.1           b8-27-eb-00-00-01     dynamic\r\n  224.0.0.22            01-00-5e-00-00-16     static\r\n');
  assert.deepEqual(win, [{ ip: '192.168.7.1', mac: 'b8:27:eb:00:00:01', dev: '192.168.7.5' }]);
  assert.equal(lan.parseDefaultRoute('[{"dst":"default","gateway":"192.168.7.1","dev":"wlan0"}]'), '192.168.7.1');
  assert.deepEqual(oui.vendor('B8-27-EB-12-34-56'), { maker: 'Raspberry Pi', private: false });
  assert.deepEqual(oui.vendor('26:aa:bb:cc:dd:ee'), { maker: null, private: true });
  assert.deepEqual(oui.vendor('d0:00:00:00:00:01'), { maker: null, private: false }, 'unknown maker');
  const s = sight.lan({ ip: '192.168.7.1', mac: 'b8:27:eb:00:00:01', maker: 'Raspberry Pi', gateway: true });
  assert.equal(s.kinds[0].kind, 'router', 'the gateway is the router, whoever made it');
});

test('Bluetooth: devices, a scan\'s lines, info, macOS, and pairing\'s questions', () => {
  const list = bt.parseDevices('Device AA:BB:CC:00:11:22 Desk Headphones\n[\x1b[0;92mNEW\x1b[0m] Device 11:22:33:44:55:66 11-22-33-44-55-66\n[CHG] Device AA:BB:CC:00:11:22 RSSI: -60\n');
  assert.deepEqual(list, [{ address: 'AA:BB:CC:00:11:22', name: 'Desk Headphones' }, { address: '11:22:33:44:55:66', name: null }]);
  const info = bt.parseInfo('Device AA:BB:CC:00:11:22 (public)\n\tName: Desk Headphones\n\tAlias: Desk Headphones\n\tIcon: audio-headset\n\tPaired: yes\n\tConnected: no\n\tUUID: Audio Sink                (0000110b-0000-1000-8000-00805f9b34fb)\n');
  assert.equal(info.icon, 'audio-headset');
  assert.ok(info.paired && info.audio && !info.connected);
  assert.equal(bt.parseInfo('\tAlias: 78-44-21-C3-DF-29\n').name, null, 'an address for an alias is no name');
  assert.deepEqual(bt.parseShow('Controller 00:11:22:33:44:55 (public)\n\tPowered: yes\n'), { controller: true, powered: true });
  const macJson = JSON.stringify({ SPBluetoothDataType: [{ device_connected: [{ 'Desk Keyboard': { device_address: 'AA:BB:CC:00:11:33', device_minorType: 'Keyboard' } }],
    device_not_connected: [{ 'Desk Headphones': { device_address: 'AA-BB-CC-00-11-22' } }] }] });
  assert.deepEqual(bt.parseMac(macJson).map(d => [d.name, d.address, d.connected]), [['Desk Keyboard', 'AA:BB:CC:00:11:33', true], ['Desk Headphones', 'AA:BB:CC:00:11:22', false]]);
  let st = { state: 'working' };
  st = bt.step(st, '[agent] Confirm passkey 123456 (yes/no): ');
  assert.equal(st.state, 'confirm'); assert.equal(st.passkey, '123456');
  assert.equal(bt.step(st, '[agent] Enter PIN code: ').state, 'pin');
  assert.equal(bt.step(st, 'Pairing successful').state, 'paired');
  assert.match(bt.step(st, 'Failed to pair: org.bluez.Error.AuthenticationFailed').message, /pairing mode/);
  const s = sight.bluetooth({ address: 'AA:BB:CC:00:11:22', ...info });
  assert.equal(s.kinds[0].kind, 'headphones');
  assert.ok(s.can.includes('bluetooth-audio'));
});

test('pairing relays its question and types the person\'s answer back; it never pairs a malformed address', async () => {
  const { EventEmitter } = require('node:events');
  const typed = [];
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: { write: s => typed.push(s) }, kill() {} });
  const p = bt.pair('aa:bb:cc:00:11:22', { spawnFn: () => child, waitMs: 2000 });
  child.stdout.emit('data', 'Agent registered\n[agent] Confirm passkey 654321 (yes/no): \n');
  const asked = await p;
  assert.equal(asked.state, 'confirm');
  assert.match(typed[0], /pair AA:BB:CC:00:11:22/);
  const answered = bt.answer('AA:BB:CC:00:11:22', 'yes');
  assert.equal(typed.at(-1), 'yes\n');
  child.stdout.emit('data', 'Pairing successful\n');
  assert.equal((await answered).state, 'paired');
  assert.match(typed.at(-1), /trust AA:BB:CC:00:11:22\nconnect AA:BB:CC:00:11:22/);
  assert.equal((await bt.pair('not-an-address; rm -rf /', { spawnFn: () => { throw new Error('spawned'); } })).state, 'failed');
});

test('catt, the tailnet and Home Assistant say what they see', () => {
  assert.deepEqual(others.parseCatt('Scanning Chromecasts...\n192.168.7.34 - Study speaker - Google Inc. Google Nest Mini\n'),
    [{ ip: '192.168.7.34', name: 'Study speaker', maker: 'Google Inc.', model: 'Google Nest Mini' }]);
  const ts = others.parseTailscale(JSON.stringify({ Self: { ID: 'self' }, Peer: { k1: { ID: 'n1', HostName: 'pixel', DNSName: 'pixel.tail0.ts.net.', OS: 'android', TailscaleIPs: ['100.64.0.2'], Online: true, LastSeen: '0001-01-01T00:00:00Z' },
    k2: { ID: 'n2', HostName: 'build-box', DNSName: 'build-box.tail0.ts.net.', OS: 'linux', TailscaleIPs: ['100.64.0.3', 'fd7a::3'], Online: false } } }));
  assert.deepEqual(ts.map(p => [p.name, p.os, p.online, p.lastSeen]), [['pixel', 'android', true, null], ['build-box', 'linux', false, null]]);
  assert.equal(sight.tailscale(ts[0]).kinds[0].kind, 'phone');
  assert.deepEqual(sight.tailscale(ts[1]).addresses, ['100.64.0.3']);
  const ha = sight.homeAssistant({ home: 'hub', id: 'media_player.den', name: 'Den', domain: 'media_player', deviceClass: 'tv', state: 'off', area: 'Den' });
  assert.equal(ha.kinds[0].kind, 'tv');
  assert.deepEqual(ha.keys, ['ha:hub/media_player.den']);
});

test('merge: one row per thing across sources, joined to what was seen before', () => {
  const cast = sight.cast({ type: '_googlecast._tcp', name: 'x', addresses: ['192.168.7.34'], port: 8009, txt: { id: 'ABC', md: 'Google Nest Mini', fn: 'Study speaker' } });
  const neigh = sight.lan({ ip: '192.168.7.34', mac: '00:f6:20:00:00:01', maker: 'Google' });
  const other = sight.lan({ ip: '192.168.7.50', mac: '00:f6:20:00:00:02', maker: 'Google' });
  const sameIpOtherMac = sight.lan({ ip: '192.168.7.50', mac: '00:f6:20:00:00:03', maker: 'Google' });
  const bluetooth = sight.bluetooth({ address: 'AA:BB:CC:00:11:22', name: 'Desk Headphones', icon: 'audio-headset' });
  const things = merge.group([cast, neigh, other, sameIpOtherMac, bluetooth]);
  assert.equal(things.length, 4, 'two MACs on one address stay two things');
  const speaker = things.find(t => t.name === 'Study speaker');
  assert.equal(speaker.kind, 'speaker');
  assert.deepEqual(speaker.sources.sort(), ['cast', 'lan']);
  assert.equal(speaker.mac, '00:f6:20:00:00:01');
  assert.deepEqual(speaker.can, ['cast']);

  const first = merge.into([], things, '2026-10-12T10:00:00.000Z');
  const again = merge.into(first, merge.group([sight.lan({ ip: '192.168.7.35', mac: '00:f6:20:00:00:01', maker: 'Google' })]), '2026-10-12T11:00:00.000Z');
  assert.equal(again.length, 4, 'the speaker on a new address is the same speaker');
  const s2 = again.find(t => t.mac === '00:f6:20:00:00:01');
  assert.equal(s2.id, first.find(t => t.mac === '00:f6:20:00:00:01').id, 'it keeps its id');
  assert.equal(s2.firstSeen, '2026-10-12T10:00:00.000Z');
  assert.equal(s2.lastSeen, '2026-10-12T11:00:00.000Z');
  assert.ok(s2.keys.includes('cast:abc'), 'what it was known by stays');
  assert.equal(again.find(t => t.bt).lastSeen, '2026-10-12T10:00:00.000Z', 'not seen this time: kept as it was');
});
