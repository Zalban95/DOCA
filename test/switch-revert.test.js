'use strict';

/**
 * A guarded switch is drawn as it really is after its password is cancelled or wrong (deep test A, 2026-10-08: the
 * specialists switch stayed drawn ON while the server said off, and missions answered 409). In a real browser: the
 * switch, a cancelled prompt, a wrong password then a cancel, and a select of the same kind — each drawn back as it was,
 * the setting unchanged. The revert is one place (lib/api.js), whoever drew the control. Skipped without a browser.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const B = require('./panel-browser');

before(async () => { await B.start({ setup: B.pastFirstRun }); if (!B.skip) { await B.evaluate("nav('harness')"); await B.until("!!document.getElementById('hc-agents-on')"); } });
after(() => B.stop());

const prompted = () => B.until("document.getElementById('app-prompt-modal')?.classList.contains('open')");
const click = sel => B.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
const enabled = async () => (await H.api(null, 'GET', '/api/harness/agents')).body.enabled;

test('the specialists switch goes back off when the password is cancelled', { skip: B.skip }, async () => {
  assert.equal(await B.evaluate("document.getElementById('hc-agents-on').checked"), false);
  await click('#hc-agents-on');   // a click flips it and fires change, as a person's does
  assert.ok(await prompted(), 'the password is asked');
  assert.equal(await B.evaluate("document.getElementById('hc-agents-on').checked"), true, 'drawn on while asking');
  await click('#app-prompt-cancel');
  assert.ok(await B.until("document.getElementById('hc-agents-on').checked === false"), 'drawn off again');
  if (process.env.DOCA_SHOTS) await B.shot(`${process.env.DOCA_SHOTS}/switch-reverted.png`);
  assert.equal(await enabled(), false);
  await B.evaluate("document.querySelector('#app-alert-modal .btn, #app-alert-ok')?.click()");
});

test('a wrong password, then cancel: still off', { skip: B.skip }, async () => {
  await B.evaluate("document.querySelectorAll('.modal-overlay.open, .app-modal.open').forEach(m => m.classList.remove('open'))");
  await click('#hc-agents-on');
  assert.ok(await prompted());
  await B.evaluate("document.getElementById('app-prompt-input').value = 'not the password'; document.getElementById('app-prompt-ok').click()");
  assert.ok(await B.until("/password|credentials|not work/i.test(document.getElementById('app-prompt-message').textContent) && document.getElementById('app-prompt-modal').classList.contains('open')"), 'asked again');
  await click('#app-prompt-cancel');
  assert.ok(await B.until("document.getElementById('hc-agents-on').checked === false"), 'drawn off again');
  assert.equal(await enabled(), false);
});

test('a switch nothing redraws — the approvals\' "ask again after outside text" — goes back too', { skip: B.skip }, async () => {
  await B.evaluate("document.querySelectorAll('.app-confirm-backdrop.open').forEach(m => m.classList.remove('open')); hcApprovalOpen()");
  assert.ok(await B.until("!!document.querySelector('#hc-approval-list .approval-recheck input[type=checkbox]')"));
  const was = await B.evaluate("document.querySelector('#hc-approval-list .approval-recheck input[type=checkbox]').checked");
  await click('#hc-approval-list .approval-recheck input[type=checkbox]');
  assert.ok(await prompted());
  await click('#app-prompt-cancel');
  assert.ok(await B.until(`document.querySelector('#hc-approval-list .approval-recheck input[type=checkbox]').checked === ${was}`), 'drawn as it was');
  assert.equal((await H.api(null, 'GET', '/api/harness/approval')).body.recheckOutside !== false, was);
  assert.deepEqual(B.errors, []);
});
