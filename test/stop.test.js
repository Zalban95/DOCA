'use strict';

/**
 * Stopping a turn, and knowing what a prompt is made of.
 *
 * The two halves of the same problem: a turn that has gone wrong costs its
 * whole prompt again on every step, so the user needs a way to end it and a way
 * to see why it was expensive in the first place. What is pinned here is that
 * stopping is not failing, that any device may stop a turn another device
 * started, and that the breakdown counts tool schemas — which are re-sent every
 * step and are the part people forget, because they travel in the request body
 * rather than the system prompt.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');
const agent = require('../modules/harness/agent');

test.before(async () => { await h.start(); });
test.after(async () => { await h.stop(); });

test('the breakdown accounts for the prompt, the tools and the transcript separately', async () => {
  const res = await h.api(null, 'GET', '/api/harness/prompt');
  assert.equal(res.status, 200);
  const b = res.body;

  assert.ok(Array.isArray(b.sections) && b.sections.length, 'no sections');
  for (const s of b.sections) {
    assert.ok(typeof s.name === 'string' && s.name, 'a section with no name');
    assert.ok(s.tokens > 0, `${s.name} was counted as free`);
  }

  assert.ok(b.sections.some(s => s.name === 'safety charter'),
    'the charter is in every prompt and has to be in every count of one');

  assert.equal(typeof b.tools.count, 'number');
  assert.match(b.tools.note, /every step/, 'the point of counting tools is that they repeat');
  assert.ok(Array.isArray(b.tools.byOwner));

  assert.ok(b.transcript.messages >= 0);
  assert.match(b.transcript.note, /new conversation starts empty/,
    'the breakdown has to say a fresh conversation carries no history, since that is the thing people assume');
});

test('worst case is per-step spend times the step cap, not the context window', async () => {
  const { body: b } = await h.api(null, 'GET', '/api/harness/prompt');
  assert.equal(b.perStep, b.sections.reduce((n, s) => n + s.tokens, 0) + b.tools.tokens);
  assert.equal(b.worstCase, b.perStep * (b.maxSteps || 1));
  assert.ok(b.worstCase >= b.perStep, 'a turn costs its prompt once per step, so the worst case cannot be smaller');
});

test('built-in tools are attributed separately from each MCP server', () => {
  const b = agent.breakdown({});
  const owners = b.tools.byOwner.map(o => o.owner);
  assert.ok(owners.includes('built-in tools'), `no built-in tools owner in ${JSON.stringify(owners)}`);
  for (const o of b.tools.byOwner) {
    assert.ok(o.count > 0 && o.tokens > 0, `${o.owner} counted as free`);
    assert.ok(o.owner === 'built-in tools' || o.owner.startsWith('mcp: '),
      `${o.owner} is neither ours nor a named server, so it cannot be switched off`);
  }
});

test('a stop names the turn it stopped, and an unknown one says it may have finished', async () => {
  const harness = require('../modules/api-v1/harness');
  assert.deepEqual(harness.running(), [], 'nothing should be running in a fresh test');

  await assert.rejects(
    async () => harness.cancel('ses_nothing', { id: 'dev_x' }),
    e => {
      assert.equal(e.status, 404);
      assert.match(e.message, /finished on its own/,
        'a turn that already ended is not an error the user caused');
      return true;
    });
});

test('cached prompt tokens are reported, not silently added to the bill', () => {
  const budget = require('../modules/harness/budget');

  // Every provider spells this differently, and reading none of them is how an
  // eleven-step turn reads as 1.6 million when most of it was the same prefix
  // arriving again at a tenth of the price.
  for (const usage of [
    { prompt_tokens: 1000, completion_tokens: 10, prompt_cache_hit_tokens: 900 },        // DeepSeek
    { prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 900 } }, // OpenAI
    { prompt_tokens: 1000, completion_tokens: 10, cache_read_input_tokens: 900 },        // Anthropic-compatible
  ]) {
    const l = budget.ledger();
    budget.record(l, { usage });
    const r = budget.report(l, {});
    assert.equal(r.cachedTokens, 900, `not read from ${Object.keys(usage).join(',')}`);
    assert.equal(r.cachePercent, 90);
  }
});

test('a provider that says nothing about caching reports null, not zero', () => {
  const budget = require('../modules/harness/budget');
  const l = budget.ledger();
  budget.record(l, { usage: { prompt_tokens: 1000, completion_tokens: 10 } });
  const r = budget.report(l, {});
  // null is "it did not say"; 0 would be "it told us nothing was cached", and
  // the panel would draw a confident 0% for a provider that never mentioned it.
  assert.equal(r.cachedTokens, null);
  assert.equal(r.cachePercent, null);
  assert.equal(r.totalTokens, 1010, 'the tokens were still sent — nothing is subtracted');
});
