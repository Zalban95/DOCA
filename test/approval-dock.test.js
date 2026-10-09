'use strict';

/**
 * A member's own waiting question is in front of them (deep test A, 2026-10-08), in a real browser: their level's card
 * for a turn started elsewhere is drawn in the questions dock and answered there; the Approvals window lists it. Skipped
 * without a browser.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const B = require('./panel-browser');
const approval = require('../modules/harness/approval');

let member;
before(() => B.start({ setup: B.pastFirstRun, as: async () => (member = await H.signIn('member', 'dock-member@test.local')) }));
after(() => B.stop());

test('the dock shows a member\'s level card and takes the answer; Approvals lists it', { skip: B.skip }, async () => {
  const q = approval.ask({ tool: 'list_dir', keys: ['list_dir'], level: true, summary: 'list_dir ~ — the level of the person this turn acts for asks', personId: member.user.id }, {});
  assert.ok(await B.until(`!!document.querySelector('#questions-dock [data-approval-id="${q.id}"]')`, 12000), 'in the dock');
  await B.evaluate("nav('harness'); hcApprovalOpen()");
  assert.ok(await B.until(`!!document.querySelector('#hc-approval-list [data-approval-id="${q.id}"]')`), 'in Approvals');
  if (process.env.DOCA_SHOTS) await B.shot(`${process.env.DOCA_SHOTS}/member-waiting.png`);
  await B.evaluate(`[...document.querySelectorAll('#questions-dock [data-approval-id="${q.id}"] button')].find(b => b.textContent === 'Allow once').click()`);
  assert.equal(await q.answer, 'once');
  assert.deepEqual(B.errors, []);
});
