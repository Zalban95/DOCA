'use strict';

/**
 * Who may connect: loopback and the tailnet by default, never the LAN.
 * The panel has no login, so this is the whole of what stands in front of it.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const net    = require('node:net');
const os     = require('node:os');
const listen = require('../modules/listen');

test('the default admits loopback and the tailnet, and nothing else', () => {
  const ok = (l, r) => listen.allowed('tailnet', l, r);
  assert.equal(ok('127.0.0.1', '127.0.0.1'), true, 'this machine');
  assert.equal(ok('::1', '::1'), true, 'this machine over IPv6');
  assert.equal(ok('::ffff:127.0.0.1', '::ffff:127.0.0.1'), true, 'IPv4 on a dual-stack socket');
  assert.equal(ok('100.115.89.4', '100.102.108.110'), true, 'a tailnet peer');
  assert.equal(ok('fd7a:115c:a1e0::1', 'fd7a:115c:a1e0::2'), true, 'a tailnet peer over IPv6');

  assert.equal(ok('192.168.1.212', '192.168.1.50'), false, 'the Wi-Fi');
  assert.equal(ok('172.17.0.1', '172.17.0.2'), false, 'a container');
  assert.equal(ok('10.0.0.5', '10.0.0.9'), false, 'another private network');
  // A LAN host that routes a packet at this machine's 100.x address reached a
  // tailnet address without being on the tailnet.
  assert.equal(ok('100.115.89.4', '192.168.1.50'), false, 'the tailnet address, dialled from the LAN');
  // 100.64.0.0/10 is 100.64–100.127; 100.128 is ordinary public space.
  assert.equal(ok('100.128.0.1', '100.128.0.2'), false, 'outside the CGNAT range');
});

test('"local" is loopback only, and "all" is everything', () => {
  assert.equal(listen.allowed('local', '127.0.0.1', '127.0.0.1'), true);
  assert.equal(listen.allowed('local', '100.115.89.4', '100.102.108.110'), false);
  assert.equal(listen.allowed('all', '192.168.1.212', '192.168.1.50'), true);
});

test('the mode comes from the environment, then prefs, and an unknown one falls back to the default', () => {
  const was = process.env.DOCA_LISTEN;
  try {
    delete process.env.DOCA_LISTEN;
    assert.equal(listen.mode({}), 'tailnet');
    assert.equal(listen.mode({ network: { listen: 'local' } }), 'local');
    process.env.DOCA_LISTEN = 'all';
    assert.equal(listen.mode({ network: { listen: 'local' } }), 'all', 'the environment wins');
    process.env.DOCA_LISTEN = 'everywhere';
    assert.equal(listen.mode({}), 'tailnet', 'a typo does not open the panel');
  } finally {
    if (was === undefined) delete process.env.DOCA_LISTEN; else process.env.DOCA_LISTEN = was;
  }
});

/** One real server, guarded, and one real connection to it. Resolves true if data came back. */
async function reaches(host, mode) {
  const server = net.createServer(s => s.end('hello'));
  listen.guard(server, mode);
  await new Promise(r => server.listen(0, '0.0.0.0', r));
  try {
    return await new Promise(resolve => {
      const c = net.connect(server.address().port, host);
      let got = '';
      c.on('data', d => { got += d; });
      c.on('close', () => resolve(got === 'hello'));
      c.on('error', () => resolve(false));
      c.setTimeout(3000, () => { c.destroy(); resolve(false); });
    });
  } finally { server.close(); }
}

test('a guarded socket answers on loopback and drops a LAN connection', async t => {
  assert.equal(await reaches('127.0.0.1', 'tailnet'), true, 'loopback is served');

  const lan = Object.values(os.networkInterfaces()).flat()
    .find(i => i && i.family === 'IPv4' && !i.internal && !listen.isTailnet(i.address));
  if (!lan) return t.skip('no non-loopback, non-tailnet IPv4 address on this machine');
  assert.equal(await reaches(lan.address, 'tailnet'), false, `${lan.address} is refused`);
  assert.equal(await reaches(lan.address, 'all'), true, 'and served again when asked for');
});
