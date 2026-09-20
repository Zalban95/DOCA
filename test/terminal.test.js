'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const WebSocket = require('ws');

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

  for (const endpoint of ['/ws/terminal', '/ws/harness']) {
    const output = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}${endpoint}`);
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
