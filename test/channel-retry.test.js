'use strict';
// A channel that could not reach its service at start tries again by itself, waiting longer each time up to a cap;
// a start that works, or a channel switched off, ends it (modules/channels/retry.js; 2026-10-15, after a power cut).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const retry = require('../modules/channels/retry');

test('waits 30 s, then doubles to at most 10 min; cleared, it starts over', () => {
  const noop = () => {};
  assert.equal(retry.later('x', noop), 30e3);
  assert.equal(retry.later('x', noop), 60e3);
  for (let i = 0; i < 10; i++) retry.later('x', noop);
  assert.equal(retry.next('x'), 10 * 60e3);
  retry.clear('x');
  assert.equal(retry.next('x'), null);
  assert.equal(retry.later('x', noop), 30e3);
  retry.clear('x');
});
