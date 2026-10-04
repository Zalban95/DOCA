'use strict';

// Money from the owner's own price list, applied when reading (modules/harness/prices.js).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const prices = require('../modules/harness/prices');
const usage = require('../modules/harness/usage');

before(() => H.start());
after(() => H.stop());

const settle = () => new Promise(r => setTimeout(r, 150));

test('no shipped prices: an unpriced model costs null, never 0', async () => {
  usage.record({ kind: 'step', provider: 'p1', model: 'big', usage: { prompt_tokens: 2_000_000, completion_tokens: 500_000, prompt_cache_hit_tokens: 1_000_000 } });
  usage.record({ kind: 'step', provider: 'local', model: 'free', usage: { prompt_tokens: 1000, completion_tokens: 10 } });
  await settle();
  const r = await H.api(null, 'GET', '/api/harness/usage?days=1&by=model');
  assert.equal(r.status, 200);
  assert.ok(r.body.rows.every(x => x.cost === null));
  assert.equal(r.body.cost, null, 'no total from no prices');
  assert.equal(r.body.unpriced, r.body.rows.length);
});

test('a typed price is applied when reading, with cached tokens at their own rate', async () => {
  const saved = await H.api(null, 'POST', '/api/harness/usage/prices', { currency: 'EUR', models: {
    'p1/big': { input: 1, cached: 0.1, output: 4 },
    'local/free': { input: 0, output: 0 },
  } });
  assert.equal(saved.status, 200);
  const r = await H.api(null, 'GET', '/api/harness/usage?days=1&by=model');
  const big = r.body.rows.find(x => x.key === 'p1/big');
  // 1M uncached at 1 + 1M cached at 0.1 + 0.5M reply at 4 = 1 + 0.1 + 2
  assert.ok(Math.abs(big.cost - 3.1) < 1e-9, `cost ${big.cost}`);
  assert.equal(r.body.rows.find(x => x.key === 'local/free').cost, 0, 'free is a price of 0 somebody typed');
  assert.equal(r.body.currency, 'EUR');
  assert.equal(r.body.unpriced, 0);
});

test('cached falls back to the input price (overstating, never understating), and bad prices are refused', () => {
  assert.equal(prices.cost({ key: 'a/b', prompt: 1e6, cached: 1e6, completion: 0 }, { models: { 'a/b': { input: 2, output: 1 } } }), 2);
  assert.throws(() => prices.save({ models: { 'a/b': { input: -1 } } }), /0 or more/);
  assert.throws(() => prices.save({ models: { 'no-slash': { input: 1 } } }), /provider\/model/);
  const r = prices.save({ models: { 'a/b': { input: '', output: '' }, 'c/d': { input: 1, output: 2 } } });
  assert.deepEqual(Object.keys(r.models), ['c/d'], 'an emptied row is removed');
});

test('other groupings carry no money, and nobody signed out may set prices', async () => {
  const day = await H.api(null, 'GET', '/api/harness/usage?days=1&by=day');
  assert.equal(day.body.cost, undefined);
  const anon = await H.api(null, 'POST', '/api/harness/usage/prices', { models: {} }, { Cookie: '' });
  assert.equal(anon.status, 401);
});
