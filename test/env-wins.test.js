'use strict';

/** One rule (audit 2026-10-06, coh F15; TODO C3): the environment wins over a saved value, and says so — the channels' half. */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

test('each channel names the secrets the environment sets, which its settings page marks as overriding', () => {
  const was = { ...process.env };
  try {
    Object.assign(process.env, { TELEGRAM_BOT_TOKEN: '1:x', MATRIX_ACCESS_TOKEN: 'syt', SLACK_BOT_TOKEN: 'xoxb', DOCA_MAIL_PASSWORD: 'p' });
    assert.deepEqual(require('../modules/channels/telegram').status().env, ['TELEGRAM_BOT_TOKEN']);
    assert.deepEqual(require('../modules/channels/matrix').status().env, ['MATRIX_ACCESS_TOKEN']);
    assert.deepEqual(require('../modules/channels/slack').status().env, ['SLACK_BOT_TOKEN']);
    assert.deepEqual(require('../modules/channels/mail').status().env, ['DOCA_MAIL_PASSWORD']);
    assert.ok(!JSON.stringify(require('../modules/channels/telegram').status()).includes('1:x'), 'the name, never the value');
  } finally {
    for (const k of ['TELEGRAM_BOT_TOKEN', 'MATRIX_ACCESS_TOKEN', 'SLACK_BOT_TOKEN', 'DOCA_MAIL_PASSWORD']) if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k];
  }
});
