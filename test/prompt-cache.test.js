'use strict';

// Cache breakpoints for Anthropic's models (experiment promptCache): the system prompt and the newest message marked,
// every other model's body untouched, nothing removed from the prompt.

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

test.after(() => H.stop());

test('an Anthropic model gets two breakpoints; any other model, or the flag off, the body as it was', async () => {
  await H.start();
  const pc = require('../modules/harness/turn/prompt-cache');
  const or = { baseUrl: 'https://openrouter.ai/api/v1' };
  const body = { model: 'anthropic/claude-opus-5.5', messages: [{ role: 'system', content: 'charter and tools' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'calling', tool_calls: [] }, { role: 'tool', tool_call_id: 'a', content: 'result' }] };
  const on = pc.apply(body, or, { on: true });
  assert.deepEqual(on.messages[0].content, [{ type: 'text', text: 'charter and tools', cache_control: { type: 'ephemeral' } }]);
  assert.deepEqual(on.messages[3].content, [{ type: 'text', text: 'result', cache_control: { type: 'ephemeral' } }]);
  assert.equal(on.messages[1].content, 'hi', 'only the two breakpoints');
  assert.equal(JSON.stringify(on).match(/cache_control/g).length, 2);
  assert.equal(pc.apply(body, or, { on: false }), body, 'flag off: as it was');
  const ds = { ...body, model: 'deepseek-flash' };
  assert.equal(pc.apply(ds, { baseUrl: 'https://api.deepseek.com/v1' }, { on: true }), ds, 'a model that caches by itself: as it was');
  assert.ok(pc.needs({ baseUrl: 'https://api.anthropic.com/v1' }, 'claude-sonnet-5.5'));
  const parts = pc.apply({ model: 'anthropic/x', messages: [{ role: 'system', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }] }, or, { on: true });
  assert.deepEqual(parts.messages[0].content[1], { type: 'text', text: 'b', cache_control: { type: 'ephemeral' } }, 'parts: the last text part carries it');
});
