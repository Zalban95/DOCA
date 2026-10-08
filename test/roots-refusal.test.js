'use strict';

/**
 * A refusal outside the allowed roots says what the rule is and not to route around it (deep test B, C12): refused by
 * read_file, the agent read /etc/passwd with `shell` instead, unasked, while the person took "allowed roots" for a wall.
 */
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('read_file outside the roots names the rule, says no setting widens it, and says to ask rather than go around', async () => {
  const outside = process.platform === 'win32' ? `${process.env.SystemRoot || 'C:\\Windows'}\\win.ini` : '/etc/hosts';
  const out = await require('../modules/harness/tools').call('read_file', { path: outside }, [], {});
  assert.match(out, /Path is outside the allowed roots/);
  assert.match(out, /no setting widens them/);
  assert.match(out, /Do not reach it another way \(shell, a script, a copy\) on your own: tell the person where it is and ask/);
});
