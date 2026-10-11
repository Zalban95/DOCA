'use strict';

/** Inference services (modules/services.js): which GPU a start uses (2026-10-11: No GPU did not stick). */
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');

test('No GPU sticks: saved as none, and a start that names no GPU uses the saved one', () => {
  const { gpuChoice } = require('../modules/services');
  assert.equal(gpuChoice('', 'all'), '', 'asked for no GPU');
  assert.equal(gpuChoice(undefined, 'none'), '', 'saved no GPU, a start that names none');
  assert.equal(gpuChoice(undefined, '1'), '1');
  assert.equal(gpuChoice(undefined, undefined), 'all', 'nothing saved: every card, as before');
  assert.equal(gpuChoice('0', 'none'), '0', 'what is asked wins');
});
