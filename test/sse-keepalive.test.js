'use strict';

// A turn's stream stays alive while the model is silent (round 1 of the test of 2026-10-16): a mastermind reasoning in
// silence sent no event for over five minutes, a client with a 300 s idle limit dropped the stream, and a dropped stream
// is a Stop. Every SSE response now carries a comment every ~15 s (here 100 ms) while it is open.

process.env.DOCA_SSE_KEEPALIVE_MS = '100';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');

let server;
before(async () => {
  await H.start();
  // A model that thinks in silence for 700 ms — seven keepalive periods — then answers.
  server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => setTimeout(() => {
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Thought it over.' }, finish_reason: 'stop' }] }));
    }, 700));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { quiet: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'quiet', model: 'm', fallbackChain: [], summarizeAfter: 0 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

async function raw(route, body) {
  const res = await fetch(`${H.base}${route}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: H.owner.cookie, Origin: H.base }, body: JSON.stringify(body) });
  assert.equal(res.status, 200);
  return res.text();
}

for (const route of ['/api/harness/chat', '/api/chat']) {
  test(`${route}: comments keep the stream alive while the model is silent, and no reader takes them for events`, async () => {
    const text = await raw(route, { message: 'think about it' });
    const first = text.indexOf(': keepalive\n\n');
    assert.ok(first >= 0, 'a keepalive came while the model said nothing');
    assert.ok((text.match(/^: keepalive$/gm) || []).length >= 3, 'and kept coming');
    assert.ok(first < text.indexOf('Thought it over.'), 'before the answer arrived');
    const events = text.split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
    assert.ok(events.some(e => e.type === 'done'), 'the stream still ends as before');
  });
}

test('the keepalive stops when the response ends', async () => {
  const { sseKeepalive } = require('../modules/utils');
  const { EventEmitter } = require('node:events');
  const res = Object.assign(new EventEmitter(), { writes: 0, writableEnded: false, destroyed: false, write() { this.writes++; } });
  sseKeepalive(res, 20);
  await H.sleep(70);
  const n = res.writes;
  assert.ok(n >= 2);
  res.emit('finish');
  await H.sleep(70);
  assert.equal(res.writes, n, 'nothing written after the end');
});
