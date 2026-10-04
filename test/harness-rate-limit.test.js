'use strict';

// A rate limit is waited out, on the same model, a bounded number of times,
// and every wait is said out loud (modules/harness/turn/rate-limit.js).

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
require('./helpers'); // Isolated data, prefs and provider files.
const { CONFIG_PATH } = require('../modules/paths');
const agent = require('../modules/harness/agent');
const budget = require('../modules/harness/budget');
const catalog = require('../modules/harness/catalog');
const memory = require('../modules/harness/memory');
const providers = require('../modules/harness/providers');
const rateLimit = require('../modules/harness/turn/rate-limit');

let server, seen = [];
const refusals = new Map();   // model → how many more 429s to send before answering

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      seen.push(body);
      const left = refusals.get(body.model) || 0;
      if (left > 0) {
        refusals.set(body.model, left - 1);
        const headers = { 'Content-Type': 'application/json' };
        if (body.model === 'hinted') headers['Retry-After'] = '0';
        if (body.model === 'patient') headers['Retry-After'] = '3600';
        res.writeHead(429, headers);
        return res.end(JSON.stringify({ error: { message: body.model === 'broke'
          ? 'You exceeded your current quota, please check your plan and billing details.'
          : 'Rate limit reached for requests' } }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Done.' } }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: {
    stub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` },
  } } }));
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
beforeEach(() => {
  seen = [];
  refusals.clear();
  catalog.saveConfig('doca', { provider: 'stub', model: 'hinted', contextWindow: 0, summarizeAfter: 0,
    fallbackChain: [], firstTokenTimeoutMs: 5000, rateLimitRetries: 2, rateLimitMaxWaitMs: 60000 });
});

const run = (model, extra = {}) => {
  catalog.saveConfig('doca', { model });
  const events = [];
  const done = agent.turn({ message: 'hello', sessionId: memory.createSession('rate limit test').id,
    emit: e => events.push(e), ...extra });
  return { done, events };
};
const waits = events => events.filter(e => e.type === 'warning' && e.kind === 'rate-limit');

test('a 429 with Retry-After is waited out on the same model, and each wait is announced', async () => {
  refusals.set('hinted', 2);
  const { done, events } = run('hinted');
  const result = await done;
  assert.equal(result.text, 'Done.');
  assert.equal(seen.length, 3, 'two refusals, then the answer');
  const w = waits(events);
  assert.equal(w.length, 2);
  assert.match(w[0].text, /HTTP 429.*as it asked.*1 of 2.*rateLimitRetries.*rateLimitMaxWaitMs.*not charged/s);
  assert.match(w[1].text, /2 of 2/);
});

test('retries run out, and then the refusal is the error, as before — never a hop down the chain', async () => {
  catalog.saveConfig('doca', { fallbackChain: [{ provider: 'stub', model: 'backup' }] });
  refusals.set('hinted', 5);
  const { done, events } = run('hinted');
  await assert.rejects(done, /HTTP 429.*rate or quota limit/s);
  assert.equal(seen.length, 3, 'the first try plus rateLimitRetries');
  assert.ok(seen.every(b => b.model === 'hinted'), 'the backup is never asked: a rate limit is an answer about this account');
  assert.equal(waits(events).length, 2);
});

test('a quota or billing refusal is not retried: waiting does not refill an account', async () => {
  refusals.set('broke', 1);
  const { done, events } = run('broke');
  await assert.rejects(done, /exceeded your current quota/);
  assert.equal(seen.length, 1);
  assert.equal(waits(events).length, 0);
});

test('a Retry-After longer than rateLimitMaxWaitMs fails at once and says how long it was asked to wait', async () => {
  refusals.set('patient', 1);
  const { done } = run('patient');
  await assert.rejects(done, /asked to wait 3600s.*rateLimitMaxWaitMs = 60000 ms.*not retried/s);
  assert.equal(seen.length, 1);
});

test('0 retries restores failing on the first 429', async () => {
  catalog.saveConfig('doca', { rateLimitRetries: 0 });
  refusals.set('hinted', 1);
  await assert.rejects(run('hinted').done, /HTTP 429/);
  assert.equal(seen.length, 1);
});

test('Stop during a wait stops the turn, without waiting the wait out', async () => {
  refusals.set('unhinted', 1);   // no Retry-After: a 2 s backoff
  const ctrl = new AbortController();
  const { done, events } = run('unhinted', { signal: ctrl.signal });
  while (!waits(events).length) await new Promise(r => setTimeout(r, 10));
  const t = Date.now();
  ctrl.abort();
  await assert.rejects(done);
  assert.ok(Date.now() - t < 1000, 'the abort ends the wait');
  assert.equal(seen.length, 1, 'nothing is sent after Stop');
});

test('Retry-After is read in seconds, as an HTTP date, and as retry-after-ms', () => {
  const h = obj => ({ get: k => obj[k] ?? null });
  assert.equal(rateLimit.retryAfterMs(h({ 'retry-after': '7' })), 7000);
  assert.equal(rateLimit.retryAfterMs(h({ 'retry-after-ms': '250', 'retry-after': '7' })), 250);
  const at = rateLimit.retryAfterMs(h({ 'retry-after': new Date(Date.now() + 5000).toUTCString() }));
  assert.ok(at > 3000 && at <= 5000, `an HTTP date becomes a delay (${at})`);
  assert.equal(rateLimit.retryAfterMs(h({})), null);
  assert.equal(rateLimit.retryAfterMs(h({ 'retry-after': 'soon' })), null);
});

test('the backoff doubles without a hint, and is capped', () => {
  const e = { status: 429, message: 'Rate limit reached' };
  const p = { rateLimitRetries: 5, rateLimitMaxWaitMs: 5000 };
  const first = rateLimit.plan(e, 0, p).waitMs, second = rateLimit.plan(e, 1, p).waitMs;
  assert.ok(first >= 2000 && first < 2250);
  assert.ok(second >= 4000 && second < 4250);
  assert.equal(rateLimit.plan(e, 3, p).waitMs, 5000);
  assert.equal(rateLimit.plan(e, 5, p), null, 'out of retries');
  assert.equal(rateLimit.plan({ status: 500, message: 'x' }, 0, p), null, 'only a 429');
});

test('the limit is in the defaults and in the agent\'s own list of limits', () => {
  const d = providers.defaultParams();
  assert.equal(d.rateLimitRetries, 2);
  assert.equal(d.rateLimitMaxWaitMs, 60000);
  assert.match(budget.block(d), /rate limits \(HTTP 429\): waited out 2 times, up to 60s each \(harness\.config\.doca\.rateLimitRetries/);
});
