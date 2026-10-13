'use strict';

// The Cast v2 sender (modules/cast/castv2; cast-reach.md §3.1) against a Cast device stand-in: the wire round-trips,
// the receiver is asked and answered by requestId, an app launched, media loaded and fetched by the device itself.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const wire = require('../modules/cast/castv2/wire');
const { connect, APPS, NS } = require('../modules/cast/castv2/sender');
const castStub = require('./fixtures/cast-stub');

test('a CastMessage encodes and decodes, whole or in pieces', () => {
  const frame = wire.encode('sender-0', 'receiver-0', NS.receiver, { type: 'GET_STATUS', requestId: 7, text: 'è'.repeat(200) });
  const got = [];
  const read = wire.reader(m => got.push(m));
  for (let i = 0; i < frame.length; i += 13) read(frame.subarray(i, i + 13));   // TLS hands bytes over in any pieces
  assert.equal(got.length, 1);
  assert.deepEqual([got[0].source, got[0].destination, got[0].namespace], ['sender-0', 'receiver-0', NS.receiver]);
  assert.equal(got[0].data.requestId, 7);
  assert.equal(got[0].data.text.length, 200);
});

test('the sender reads status, launches the media receiver, loads media the device fetches, sets volume and stops', async () => {
  const dev = await castStub.start();
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(Buffer.alloc(1000)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const s = await connect({ host: '127.0.0.1', port: dev.port });
  try {
    assert.equal((await s.status()).volume.level, 0.4);
    const app = await s.launch(APPS.media);
    assert.ok(app.transportId);
    const url = `http://127.0.0.1:${srv.address().port}/a.wav`;
    const r = await s.request(app.transportId, NS.media, { type: 'LOAD', media: { contentId: url, contentType: 'audio/wav', streamType: 'BUFFERED' }, autoplay: true });
    assert.equal(r.data.status[0].playerState, 'PLAYING');
    assert.deepEqual(dev.fetched.map(f => [f.url, f.status, f.bytes]), [[url, 200, 1000]]);
    await s.volume(0.25);
    assert.equal((await s.status()).volume.level, 0.25);
    await s.stop(app.sessionId);
    assert.deepEqual((await s.status()).applications, []);
  } finally { s.close(); await dev.close(); srv.close(); }
});

test('an unreachable device is said in words, not a stack', async () => {
  await assert.rejects(connect({ host: '127.0.0.1', port: 1, timeoutMs: 2000 }), /Cannot reach the Cast device at 127\.0\.0\.1:1/);
});
