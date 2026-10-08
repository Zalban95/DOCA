'use strict';

/**
 * A model is waited on as long as the settings say (deep test B3): Node's fetch stopped waiting for headers at 300 s
 * whatever `firstTokenTimeoutMs` said, and the turn ended as a bare "fetch failed". The transport now speaks node:http
 * (turn/http-request.js), whose only deadline is the caller's. Here fetch is replaced by one that fails the way undici
 * does at its ceiling, at once — so a transport that still used it cannot pass — and the stub holds its headers.
 */
require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let server, base, holdMs = 0, chunks = ['read it all'];
before(async () => {
  server = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
    req.resume();
    req.on('end', () => {
      const t = setTimeout(async () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const c of chunks) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`); await new Promise(r => setTimeout(r, 20)); }
        res.end('data: [DONE]\n\n');
      }, holdMs);
      res.on('close', () => clearTimeout(t));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/v1`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

const realFetch = global.fetch;
const undiciCap = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('Headers Timeout Error'), { code: 'UND_ERR_HEADERS_TIMEOUT' }) }); };

const call = ({ timeoutMs, signal, onText } = {}) => {
  const { complete } = require('../modules/harness/turn/transport');
  const p = { ...require('../modules/harness/agent').params(), fallbackChain: [], firstTokenTimeoutMs: timeoutMs };
  return complete({ ep: { id: 'queue-box', label: 'queue box', baseUrl: base, apiKey: '' }, p, signal, onText,
    body: { model: 'm', stream: true, messages: [{ role: 'user', content: 'hello' }] } });
};

test('a model that holds its headers is waited on as long as firstTokenTimeoutMs says, not fetch\'s ceiling', async () => {
  global.fetch = undiciCap;
  try {
    holdMs = 1200; chunks = ['read ', 'it all'];
    const seen = [];
    const reply = await call({ timeoutMs: 5000, onText: t => seen.push(t) });
    assert.equal(reply.content, 'read it all');
    assert.deepEqual(seen, ['read ', 'it all'], 'streamed as it came');
  } finally { global.fetch = realFetch; }
});

test('past the setting it stops, saying how long and which setting', async () => {
  holdMs = 3000; chunks = ['late'];
  const e = await call({ timeoutMs: 1000 }).then(() => null, x => x);
  assert.ok(e, 'it stopped waiting');
  assert.match(e.message, /queue box held the connection open for 1s .*harness\.config\.doca\.firstTokenTimeoutMs/);
  assert.doesNotMatch(e.message, /fetch failed/);
});

test('a person\'s Stop ends the wait and the stream, as an abort', async () => {
  holdMs = 2000; chunks = ['x'];
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 200);
  const t = Date.now();
  const e = await call({ timeoutMs: 10000, signal: ctrl.signal }).then(() => null, x => x);
  assert.equal(e?.name, 'AbortError');
  assert.ok(Date.now() - t < 1500, 'at once, not at the server\'s pace');

  holdMs = 0; chunks = Array.from({ length: 50 }, (_, i) => `w${i} `);
  const c2 = new AbortController();
  const got = [];
  const e2 = await call({ timeoutMs: 10000, signal: c2.signal, onText: x => { got.push(x); if (got.length === 3) c2.abort(); } }).then(() => null, x => x);
  assert.equal(e2?.name, 'AbortError', 'mid-stream too');
  assert.ok(got.length < 50);
});
