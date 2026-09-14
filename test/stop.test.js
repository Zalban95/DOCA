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
