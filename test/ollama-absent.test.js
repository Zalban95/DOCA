'use strict';

// A machine without Ollama (self-test 2026-10-08, #11, #15): its model list is an empty list with the reason, a 200,
// and its status says in plain words that Ollama is not installed or not running, with where to install it; an
// Ollama that answers wrongly is still an error.

const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const H = require('./helpers');

let stub, closed;
const useOllama = url => {
  const { loadPrefs, savePrefs } = require('../modules/utils');
  const p = loadPrefs(); savePrefs({ ...p, models: { ...(p.models || {}), ollamaUrl: url } });
};

test.before(async () => {
  await H.start();
  stub = http.createServer((req, res) => { res.statusCode = 500; res.end('boom'); });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  // A port nothing listens on: taken, then let go.
  const tmp = http.createServer(); await new Promise(r => tmp.listen(0, '127.0.0.1', r));
  closed = `http://127.0.0.1:${tmp.address().port}`; await new Promise(r => tmp.close(r));
});
test.after(async () => { stub.close(); await H.stop(); });

test('nothing at Ollama\'s address: an empty list and the reason, not a 503', async () => {
  useOllama(closed);
  const r = await H.api(null, 'GET', '/api/models/ollama/list');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.models, []);
  assert.equal(r.body.code, 'ollama_unreachable');
  assert.match(r.body.reason, /not installed or not running/);
  assert.match(r.body.reason, /System tools/);
  assert.equal(r.body.url, closed, 'the address stays, for the detail line');
});

test('an Ollama that answers with an error is still an error', async () => {
  useOllama(`http://127.0.0.1:${stub.address().port}`);
  const r = await H.api(null, 'GET', '/api/models/ollama/list');
  assert.equal(r.status, 502);
  assert.match(r.body.error, /HTTP 500/);
});
