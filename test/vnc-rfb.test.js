'use strict';

/**
 * DOCA's own RFB client (modules/vnc-targets/rfb.js, des.js) against a stub VNC server (fixtures/rfb-stub.js): no
 * password and a VNC password with a known challenge, RFB 3.8 and 3.3, a Raw screen with a CopyRect giving a known PNG,
 * and the events vnc_input sends.
 */
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const stub = require('./fixtures/rfb-stub');
const rfb = require('../modules/vnc-targets/rfb');
const des = require('../modules/vnc-targets/des');
const png = require('../modules/machines/png');
const input = require('../modules/vnc-targets/input');

test('DES gives FIPS\' test vector, and VNC\'s answer matches one computed by OpenSSL', () => {
  assert.equal(des.encryptBlock(Buffer.from('133457799BBCDFF1', 'hex'), Buffer.from('0123456789ABCDEF', 'hex')).toString('hex'), '85e813540f0ab405');
  assert.ok(des.vncResponse(stub.CHALLENGE, 'secret').equals(stub.SECRET_RESPONSE));
  assert.ok(des.vncResponse(stub.CHALLENGE, 'secretsXYZ').equals(des.vncResponse(stub.CHALLENGE, 'secretsX')), 'only the first eight characters count');
});

test('no password: the screen comes back, Raw then CopyRect, as a PNG of exactly those pixels', async t => {
  const s = await stub.start();
  t.after(() => s.close());
  const img = await rfb.capture({ host: '127.0.0.1', port: s.port });
  assert.deepEqual([img.width, img.height, img.name], [4, 2, 'stub screen']);
  assert.ok(img.rgb.equals(stub.expected(4, 2)));
  const back = png.fromPng(png.encode(img));
  assert.deepEqual([back.width, back.height], [4, 2]);
  assert.ok(back.rgb.equals(stub.expected(4, 2)), 'the PNG holds the screen as it was sent');
  assert.equal(s.got[0].shared, 1, 'shared: a person watching keeps watching');
  assert.deepEqual(s.got.find(g => g.type === 'encodings').list, [0, 1], 'Raw and CopyRect, nothing it cannot read');
});

test('a VNC password: the right one gets in, a wrong or missing one is said plainly; RFB 3.3 too', async t => {
  const s = await stub.start({ password: 'secret' });
  t.after(() => s.close());
  assert.ok((await rfb.capture({ host: '127.0.0.1', port: s.port, password: 'secret' })).rgb.equals(stub.expected(4, 2)));
  await assert.rejects(rfb.capture({ host: '127.0.0.1', port: s.port, password: 'nope' }), /refused: wrong password/);
  await assert.rejects(rfb.capture({ host: '127.0.0.1', port: s.port }), /asks for a password, and none is kept/);
  const old = await stub.start({ password: 'hunter22', minor: 3 });
  t.after(() => old.close());
  assert.ok((await rfb.capture({ host: '127.0.0.1', port: old.port, password: 'hunter22' })).rgb.equals(stub.expected(4, 2)));
  await assert.rejects(rfb.capture({ host: '127.0.0.1', port: old.port, password: 'wrong' }), /refused the password/);
});

test('reachability is a greeting; nothing listening is null, not an error', async t => {
  const s = await stub.start();
  t.after(() => s.close());
  assert.equal(await rfb.greets('127.0.0.1', s.port), '003.008');
  const net = require('node:net');
  const quiet = net.createServer(() => {});
  await new Promise(r => quiet.listen(0, '127.0.0.1', r));
  const port = quiet.address().port;
  quiet.close();
  assert.equal(await rfb.greets('127.0.0.1', port), null);
});

test('clicks, scrolls, keys and text become pointer and key events', async t => {
  const s = await stub.start();
  t.after(() => s.close());
  const target = { host: '127.0.0.1', port: s.port };
  const size = await rfb.act(target, input.click(3, 1, 'left', 2), { gapMs: 0 });
  assert.deepEqual([size.width, size.height], [4, 2]);
  await rfb.act(target, [...input.scroll(1, 1, 'up', 1), ...input.combo('ctrl+l'), ...input.typing('aB')], { gapMs: 0 });
  await new Promise(r => setTimeout(r, 100));
  const pointer = s.got.filter(g => g.type === 'pointer');
  assert.deepEqual(pointer.slice(0, 5).map(p => p.mask), [0, 1, 0, 1, 0], 'a double click');
  assert.ok(pointer.slice(0, 5).every(p => p.x === 3 && p.y === 1));
  assert.deepEqual(pointer.slice(5).map(p => p.mask), [0, 8, 0], 'one notch up is button 4');
  const keys = s.got.filter(g => g.type === 'key').map(k => `${k.down ? '+' : '-'}${k.sym.toString(16)}`);
  assert.deepEqual(keys, ['+ffe3', '+6c', '-6c', '-ffe3', '+61', '-61', '+ffe1', '+42', '-42', '-ffe1'], 'ctrl+l, then "a" and a shifted "B"');
  assert.throws(() => input.combo('ctrl+nosuchkey'), /not a key DOCA knows/);
  assert.equal(input.keysym('F5'), 0xffc2);
});
