'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const WebSocket = require('ws');
// An isolated data directory, and someone to sign in: both sockets are a shell
// on the host, so they need a session with the "host" right.
const H = require('./helpers');

test('node-pty loads only for a terminal connection and retries if unavailable', async t => {
  let attempts = 0;
  const load = Module._load;
  t.mock.method(Module, '_load', function (id, ...args) {
    if (id === 'node-pty') {
      attempts++;
      throw new Error('node-pty unavailable in this test');
    }
    return load.call(this, id, ...args);
  });

  const terminal = require('../modules/terminal');
  assert.equal(attempts, 0, 'importing the terminal must not load the native addon');
  const server = http.createServer();
  terminal.setup(server);
  assert.equal(attempts, 0, 'attaching terminal endpoints must not load the native addon');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const owner = await H.signIn('owner');
  for (const endpoint of ['/ws/terminal', '/ws/harness']) {
    const output = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}${endpoint}`, { headers: { Cookie: owner.cookie } });
      t.after(() => ws.terminate());
      let data = '';
      ws.on('message', raw => { data += JSON.parse(raw).data || ''; });
      ws.on('error', reject);
      ws.on('close', () => resolve(data));
    });
    assert.match(output, /node-pty is not installed/);
    assert.match(output, /Settings → System Tools/);
  }
  assert.equal(attempts, 2, 'a missing addon must be retried on the next connection');
});

test('a terminal socket without a session, or without the host right, is refused', async t => {
  const terminal = require('../modules/terminal');
  const server = http.createServer();
  terminal.setup(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const member = await H.signIn('member');
  const open = headers => new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws/terminal`, { headers });
    ws.on('open', () => { ws.terminate(); resolve('opened'); });
    ws.on('error', e => resolve(e.message));
  });
  assert.match(await open({}), /401/, 'nobody');
  assert.match(await open({ Cookie: member.cookie }), /401/, 'a member cannot open a shell');
  assert.match(await open({ Cookie: 'doca_session=forged' }), /401/, 'a made-up session');
});
