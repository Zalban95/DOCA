'use strict';

// What a provider accepts, learned once and then sent that way (modules/harness/contracts.js).

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');
const catalog = require('../modules/harness/catalog');
const contracts = require('../modules/harness/contracts');
const agent = require('../modules/harness/agent');
const { loadPrefs, savePrefs } = require('../modules/utils');

let server, seen = [];
before(async () => {
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw);
      seen.push({ path: req.url, body });
      const strict = req.url.startsWith('/strict');      // refuses stream_options, without saying which field
      const newer = body.model === 'reasoner';           // wants max_completion_tokens, and says so
      if ((strict && body.stream_options) || (newer && body.max_tokens !== undefined)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: newer ? "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." : 'Bad request' } }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: {
    strict: { baseUrl: `${base}/strict/v1` }, openish: { baseUrl: `${base}/openish/v1` },
  } } }));
  await H.start();
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });
beforeEach(() => { seen = []; contracts.forget('strict'); contracts.forget('openish'); });

const ask = (provider, model) => agent.ask({ system: 's', user: 'u', provider, model });

test('a server that refuses usage frames costs one failed request, once', async () => {
  catalog.saveConfig('doca', { provider: 'strict', model: 'm', maxTokens: 256, fallbackChain: [] });
  assert.equal(await ask('strict', 'm'), 'ok');
  assert.equal(seen.length, 2, 'refused, then retried without stream_options');
  assert.deepEqual(contracts.forProvider('strict', 'm'), { streamUsage: false });
  seen = [];
  assert.equal(await ask('strict', 'm'), 'ok');
  assert.equal(seen.length, 1, 'the second call is sent the way it was accepted');
  assert.equal(seen[0].body.stream_options, undefined);
});

test('a model that wants max_completion_tokens is learned per model, not for the whole provider', async () => {
  catalog.saveConfig('doca', { provider: 'openish', model: 'reasoner', maxTokens: 512, fallbackChain: [] });
  assert.equal(await ask('openish', 'reasoner'), 'ok');
  assert.equal(seen.length, 2);
  seen = [];
  await ask('openish', 'reasoner');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].body.max_completion_tokens, 512);
  assert.equal(seen[0].body.max_tokens, undefined);
  assert.deepEqual(contracts.forProvider('openish', 'other-model'), {}, 'another model on the same server is not assumed to need it');
});

test('the owner\'s prefs override a lesson, and a lesson can be forgotten', async () => {
  contracts.learn('strict', 'm', { streamUsage: false });
  const prefs = loadPrefs();
  savePrefs({ ...prefs, providerContracts: { strict: { streamUsage: true } } });
  assert.deepEqual(contracts.forProvider('strict', 'm'), { streamUsage: true }, 'the correction wins');
  savePrefs(prefs);

  const listed = await H.api(null, 'GET', '/api/harness/contracts');
  assert.equal(listed.body.learned.strict.streamUsage, false);
  const del = await H.api(null, 'DELETE', '/api/harness/contracts/strict');
  assert.equal(del.status, 200);
  assert.deepEqual(contracts.forProvider('strict', 'm'), {});
});
