'use strict';

/**
 * A kept-alive connection the server already let go of (turn/http-request.js): llama.cpp's router drops the socket a
 * streamed answer came on, Node reuses it for the next step, and the request is lost before the server reads it —
 * "socket hang up" on the second step of every turn on a local model (2026-10-09). Such a request goes again, once,
 * on a fresh connection; one the server did answer, or that hung up on a fresh connection, is not sent twice.
 */
require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let server, url, seen = 0, dropFresh = false;
const served = new WeakMap();   // socket → requests answered on it
before(async () => {
  server = http.createServer((req, res) => {
    seen++;
    const n = served.get(req.socket) || 0;
    // Like the router: a second request on a socket that already carried a stream is dropped unread.
    if (n >= 1 || dropFresh) return req.socket.destroy();
    served.set(req.socket, n + 1);
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  server.keepAliveTimeout = 5000;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
});
after(() => server.close());

const { post } = require('../modules/harness/turn/http-request');
const ask = () => post(url, { headers: { 'content-type': 'application/json' }, body: '{}' }).then(async r => [r.status, await r.text()]);

test('a request lost on a reused connection is sent again once, fresh — the second step answers', async () => {
  const first = await ask();
  assert.equal(first[0], 200);
  seen = 0;
  const second = await ask();
  assert.equal(second[0], 200, 'the second request reached the server on a fresh connection');
  assert.match(second[1], /hi/);
  assert.equal(seen, 2, 'once on the dropped socket, once fresh — never more');
});

test('a hang-up on a fresh connection is not retried: it is the server\'s answer', async () => {
  dropFresh = true;
  try {
    seen = 0;
    await assert.rejects(post(url, { headers: {}, body: '{}' }), /socket hang up|ECONNRESET/);
    assert.ok(seen <= 2, `sent ${seen} times`);
  } finally { dropFresh = false; }
});
