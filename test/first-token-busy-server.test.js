'use strict';

/**
 * The first-token deadline follows the work on a local model (self-test round two, C8): 90 s ended four turns on a
 * slow shared model. At the deadline a local server is asked whether it is working (llama.cpp's /slots), and while it
 * is the wait goes on — up to ten times the setting; an idle one is the stall it looks like, said with the setting.
 */
require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let server, base, busy = true, holdMs = 0;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/slots') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify([{ id: 0, is_processing: busy }])); }
    if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
    req.resume();
    req.on('end', () => {
      const t = setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'read it all' } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      }, holdMs);
      res.on('close', () => clearTimeout(t));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/v1`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

const call = (waits = []) => {
  const { complete } = require('../modules/harness/turn/transport');
  const p = { ...require('../modules/harness/agent').params(), fallbackChain: [], firstTokenTimeoutMs: 300 };
  return complete({ ep: { id: 'own-box', label: 'own box', baseUrl: base, apiKey: '', local: true }, p, onWaiting: w => waits.push(w),
    body: { model: 'm', messages: [{ role: 'user', content: 'a long prompt' }] } });
};

test('a local server that says it is working is waited on past the setting', async () => {
  busy = true; holdMs = 1100;   // past 300 ms more than three times
  const waits = [];
  const reply = await call(waits);
  assert.equal(reply.content, 'read it all');
  assert.ok(waits.some(w => w.working && w.timeoutMs > 300), `the waiting row says the wait goes on: ${JSON.stringify(waits.slice(-1))}`);
});

test('an idle local server is a stall, named by its setting', async () => {
  busy = false; holdMs = 1500;
  const e = await call().then(() => null, x => x);
  assert.ok(e, 'it stopped waiting');
  assert.match(e.message, /harness\.config\.doca\.firstTokenTimeoutMs/);
  assert.doesNotMatch(e.message, /said it was working/);
});

test('a server that keeps working is waited on only up to ten times the setting, and says so', async () => {
  busy = true; holdMs = 6000;
  const t = Date.now();
  const e = await call().then(() => null, x => x);
  assert.ok(e && Date.now() - t < 5000, `it gave up at the ceiling (${Date.now() - t} ms)`);
  assert.match(e.message, /firstTokenTimeoutMs/);
  assert.match(e.message, /said it was working, so the wait went on past the setting/);
});

test('a provider that is not local is never asked: its silence is the stall', async () => {
  const { working } = require('../modules/harness/turn/busy-server');
  busy = true;
  assert.equal(await working({ id: 'cloud', baseUrl: base, local: false }), false);
  assert.equal(await working({ id: 'own-box', baseUrl: base, local: true }), true);
});
