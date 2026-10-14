'use strict';

/**
 * A guarded switch is drawn as it really is after its notice or its password is cancelled (deep test A, 2026-10-08: the
 * specialists switch stayed drawn ON while the server said off, and missions answered 409). In a real browser: the
 * switch's notice cancelled, continued with "Don't show this again" (not shown again, until Settings shows them all
 * again), a list loading under it, a control nothing redraws, and a password switch — the rules guard switched off —
 * with a wrong password then a cancel: each drawn back as it was, the setting unchanged. The revert is one place
 * (lib/api.js), whoever drew the control (CONSTITUTION S14, 2026-10-14). Skipped without a browser.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const B = require('./panel-browser');

before(async () => { await B.start({ setup: B.pastFirstRun }); if (!B.skip) { await B.evaluate("nav('harness')"); await B.until("!!document.getElementById('hc-agents-on') && !document.querySelector('#hc-agents .placeholder')?.textContent.includes('Loading')"); } });
after(() => B.stop());

const prompted = () => B.until("document.getElementById('app-prompt-modal')?.classList.contains('open')");
const noticed = () => B.until("document.getElementById('app-confirm-modal')?.classList.contains('open') && !!document.querySelector('#app-confirm-modal .app-notice-hide')");
const answer = label => B.evaluate(`[...document.querySelectorAll('#app-confirm-modal .app-choose-btn')].find(b => b.textContent === ${JSON.stringify(label)}).click()`);
const click = sel => B.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
const enabled = async () => (await H.api(null, 'GET', '/api/harness/agents')).body.enabled;

test('the specialists switch shows its notice, and goes back off when it is cancelled', { skip: B.skip }, async () => {
  assert.equal(await B.evaluate("document.getElementById('hc-agents-on').checked"), false);
  await click('#hc-agents-on');   // a click flips it and fires change, as a person's does
  assert.ok(await noticed(), 'the notice is shown — no password');
  assert.match(await B.evaluate("document.getElementById('app-confirm-message').textContent"), /Specialists/);
  assert.equal(await B.evaluate("document.getElementById('app-prompt-modal').classList.contains('open')"), false);
  assert.equal(await B.evaluate("document.getElementById('hc-agents-on').checked"), true, 'drawn on while asking');
  await answer('Cancel');
  assert.ok(await B.until("document.getElementById('hc-agents-on').checked === false"), 'drawn off again');
  if (process.env.DOCA_SHOTS) await B.shot(`${process.env.DOCA_SHOTS}/switch-reverted.png`);
  assert.equal(await enabled(), false);
});

test('Continue with "Don\'t show this again": switched, and not shown again until the notices are reset', { skip: B.skip }, async () => {
  await click('#hc-agents-on');
  assert.ok(await noticed());
  await B.evaluate("document.querySelector('#app-confirm-modal .app-notice-hide input').click()");
  await answer('Continue');
  assert.ok(await B.until("!document.querySelector('#app-confirm-modal .app-notice-hide')"), 'the tick goes with the notice');
  for (let i = 0; i < 40 && !(await enabled()); i++) await B.sleep(100);
  assert.equal(await enabled(), true, 'switched on, without a password');
  assert.ok(await B.until("document.getElementById('hc-agents-on')?.checked === true"));
  await click('#hc-agents-on');
  for (let i = 0; i < 40 && (await enabled()); i++) await B.sleep(100);
  assert.equal(await enabled(), false, 'switched off with no notice: it was not to be shown again');
  assert.equal(await B.evaluate("document.getElementById('app-confirm-modal').classList.contains('open')"), false);
  assert.equal((await H.api(null, 'DELETE', '/api/auth/notices')).body.reset, 1);
  assert.ok(await B.until("document.getElementById('hc-agents-on')?.checked === false"));
  await click('#hc-agents-on');
  assert.ok(await noticed(), 'shown again after the reset');
  await answer('Cancel');
  assert.ok(await B.until("document.getElementById('hc-agents-on').checked === false"));
});

test('a list still loading when the switch is turned does not draw it back under the notice', { skip: B.skip }, async () => {
  // What failed on a slow Windows runner: the page's first load of the specialists landed while the question was open.
  await B.evaluate("_hcLoadAgents(); document.getElementById('hc-agents-on').click()");
  assert.ok(await noticed());
  await B.sleep(1500);   // the load started before the click has long landed
  assert.equal(await B.evaluate("document.getElementById('hc-agents-on').checked"), true, 'still drawn on while asking');
  await answer('Cancel');
  assert.ok(await B.until("document.getElementById('hc-agents-on').checked === false"), 'drawn off again');
  assert.equal(await enabled(), false);
});

test('a switch nothing redraws — the approvals\' "ask again after outside text" — goes back too', { skip: B.skip }, async () => {
  await B.evaluate("hcApprovalOpen()");
  assert.ok(await B.until("!!document.querySelector('#hc-approval-list .approval-recheck input[type=checkbox]')"));
  const was = await B.evaluate("document.querySelector('#hc-approval-list .approval-recheck input[type=checkbox]').checked");
  await click('#hc-approval-list .approval-recheck input[type=checkbox]');
  assert.ok(await noticed());
  await answer('Cancel');
  assert.ok(await B.until(`document.querySelector('#hc-approval-list .approval-recheck input[type=checkbox]').checked === ${was}`), 'drawn as it was');
  assert.equal((await H.api(null, 'GET', '/api/harness/approval')).body.recheckOutside !== false, was);
});

test('a password switch — a guard switched off — asks it; a wrong one, then cancel: still on', { skip: B.skip }, async () => {
  await B.evaluate("document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')); settingsSubNav('harness')");
  const box = "document.querySelector('#guards-list .guard-row .guard-on input')";
  assert.ok(await B.until(`${box}?.checked === true`), 'the rules guard is on');
  await B.evaluate(`${box}.click()`);
  assert.ok(await prompted(), 'the password is asked');
  await B.evaluate("document.getElementById('app-prompt-input').value = 'not the password'; document.getElementById('app-prompt-ok').click()");
  assert.ok(await B.until("/password|credentials|not work/i.test(document.getElementById('app-prompt-message').textContent) && document.getElementById('app-prompt-modal').classList.contains('open')"), 'asked again');
  await click('#app-prompt-cancel');
  assert.ok(await B.until(`${box}.checked === true`), 'drawn on again');
  assert.equal((await H.api(null, 'GET', '/api/harness/guards')).body.guards.find(g => g.id === 'rules').enabled, true);
  await B.evaluate("document.querySelectorAll('#app-confirm-modal.open .btn').forEach(b => b.offsetParent && b.click())");   // the refusal's alert
  assert.deepEqual(B.errors, []);
});
