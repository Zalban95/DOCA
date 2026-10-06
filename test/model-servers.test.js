'use strict';

/** Every local model server and whom it works for (modules/model-servers.js, harness/inflight.js; audit 2026-10-06). */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const servers = require('../modules/model-servers');
const inflight = require('../modules/harness/inflight');

const serve = handler => new Promise(r => { const s = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); handler(req, res); }); s.listen(0, '127.0.0.1', () => r(s)); });
let child, router, single;
test.before(async () => {
  child = await serve((req, res) => res.end(JSON.stringify(req.url === '/slots' ? [{ id: 0, is_processing: true }] : {})));
  const port = child.address().port;
  router = await serve((req, res) => res.end(JSON.stringify(req.url === '/models' ? { data: [
    { id: 'big', status: { value: 'loaded', args: ['llama-server', '--port', String(port)] } },
    { id: 'small', status: { value: 'sleeping', args: ['llama-server', '--port', '1'] } }] } : {})));
  single = await serve((req, res) => (req.url === '/slots' ? res.end('[{"id":0,"is_processing":false}]')
    : req.url === '/v1/models' ? res.end('{"data":[{"id":"one"}]}') : (res.statusCode = 404, res.end('{}'))));
});
test.after(() => { child.close(); router.close(); single.close(); });

test('a llama.cpp router says what it holds; a loaded model\'s own server says it is generating', async () => {
  const s = await servers.probe({ id: 'llamacpp', baseUrl: `http://127.0.0.1:${router.address().port}/v1` });
  assert.equal(s.kind, 'llama.cpp router');
  assert.deepEqual(s.models, [{ id: 'big', state: 'working' }, { id: 'small', state: 'sleeping' }]);
  const one = await servers.probe({ id: 'x', baseUrl: `http://127.0.0.1:${single.address().port}/v1` });
  assert.equal(one.kind, 'llama-server');
  assert.deepEqual(one.models, [{ id: 'one', state: 'loaded' }]);
  assert.equal((await servers.probe({ id: 'y', baseUrl: 'http://127.0.0.1:1/v1' })).answering, false);
});

test('busy with one of DOCA\'s requests is DOCA\'s; busy with none of them is someone else\'s, said plainly', async () => {
  const ep = { id: 'llamacpp', label: 'llama.cpp', baseUrl: `http://127.0.0.1:${router.address().port}/v1` };
  const s = await servers.probe(ep);
  assert.equal(servers.join(ep, s, inflight.list()).foreign, true, 'working, and nothing of DOCA\'s in flight');
  const done = inflight.start({ provider: 'llamacpp', model: 'big', kind: 'fold', sessionId: null });
  const j = servers.join(ep, s, inflight.list());
  assert.equal(j.foreign, false);
  assert.equal(j.doca[0].text, 'folding a long conversation');
  done();
  assert.equal(inflight.list().length, 0, 'gone when the request ends');
});
