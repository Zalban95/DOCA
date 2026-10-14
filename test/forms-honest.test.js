'use strict';

/**
 * Forms say what happened (the owner's UI rule; newcomer run 2026-10-14, on a core-only install): each button the run
 * found silent or falsely successful, pressed with a real mouse in a real browser on a hub with no licence, and what the
 * page then says. Skipped where no Chrome, Edge or Chromium is found.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
// The core only, as a newcomer's install runs: the suite's preloaded licence for everything left out before the app is made.
require('../modules/license/keys').preloaded.certificate = null;
require('../modules/license').reload();
const B = require('./panel-browser');

before(() => B.start({ setup: B.pastFirstRun }));
after(() => B.stop());

const text = sel => B.evaluate(`(document.querySelector(${JSON.stringify(sel)})?.textContent || '').trim()`);

test('the hub runs the core only', { skip: B.skip }, async () => {
  assert.equal(await B.evaluate("fetch('/api/licence').then(r => r.json()).then(j => j.source)"), 'none');
});

test('Backups: saving an empty password says nothing was saved', { skip: B.skip }, async () => {
  await B.open('#settings/backups');
  assert.ok(await B.until("!!document.getElementById('backup-password') && document.getElementById('backup-password').getClientRects().length > 0"), 'the password field is drawn');
  assert.ok(await B.clickOn('#backup-password-row button[onclick="backupPasswordSave()"]'));
  assert.ok(await B.until("/Nothing saved/.test(document.getElementById('backup-status')?.textContent || '')"), await text('#backup-status'));
  assert.doesNotMatch(await text('#backup-status'), /Password saved/);
  assert.deepEqual(B.errors, []);
});
