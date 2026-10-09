'use strict';

/**
 * An approval explained, as a person sees it (agent-ui/approval.js approvalExplainInto; the owner, 2026-10-09): the
 * agent's words labelled as the agent's, what the call does, and the exact request in a fold that is closed until
 * opened and remembered per browser — in the popup and the transcript card, at a desk's width and a phone's, in the
 * Points look dark and light. Skipped without a browser; DOCA_SHOTS=<folder> keeps the pictures.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const B = require('./panel-browser');
const approval = require('../modules/harness/approval');
const explain = require('../modules/harness/approval-explain');

before(() => B.start({ setup: B.pastFirstRun }));
after(() => B.stop());

const SHOTS = process.env.DOCA_SHOTS;
const ARGS = { command: 'cd ~/projects/site && rm -f build.log cache.tmp && git push origin main' };

test('the popup shows why, what it does and the request folded; the fold opens and is remembered', { skip: B.skip }, async () => {
  const req = explain.explain(approval.gate('shell', ARGS, { forceAsk: true }), 'shell', ARGS,
    { reply: { content: 'The build log and cache are stale. I will clear them and push the fix to main.' } });
  const q = approval.ask({ ...req, personId: H.owner.user.id }, {});
  const evt = JSON.stringify({ id: q.id, ...req });
  await B.evaluate(`approvalPopup(${evt})`);
  const card = '#approval-overlay .approval-card';
  assert.ok(await B.until(`!!document.querySelector('${card} .approval-does')`), 'drawn');
  const order = await B.evaluate(`[...document.querySelector('${card}').children].map(c => c.className.split(' ')[0])`);
  assert.deepEqual(order.slice(0, 5), ['approval-head', 'approval-why', 'approval-does', 'approval-way', 'approval-asked']);
  assert.ok(order.includes('adv-fold'), 'the request is a fold');
  assert.equal(await B.evaluate(`document.querySelector('${card} .approval-why .approval-label').textContent`), 'The agent says');
  assert.equal(await B.evaluate(`document.querySelector('${card} details').open`), false, 'closed by default');
  assert.equal(await B.evaluate(`document.querySelector('${card} .approval-detail').textContent`), ARGS.command);

  for (const [skin, theme, w] of [['classic', 'default', 1300], ['points', 'points', 1300], ['points', 'pointsDaylight', 390], ['points', 'points', 390]]) {
    await B.viewport(w, w < 600 ? 844 : 900);
    await B.evaluate(`lookApply(${JSON.stringify(skin)}); applyTheme(${JSON.stringify(theme)})`);
    const fits = await B.evaluate(`(() => { const r = document.querySelector('${card}').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; })()`);
    assert.ok(fits, `the card fits ${w} px in ${skin}/${theme}`);
    if (SHOTS) await B.shot(`${SHOTS}/approval-${skin}-${theme}-${w}.png`);
  }
  await B.evaluate(`document.querySelector('${card} details > summary').click()`);
  assert.equal(await B.evaluate("localStorage.getItem('doca.fold.approval-request')"), '1', 'opening it is remembered');
  if (SHOTS) await B.shot(`${SHOTS}/approval-open-390.png`);
  await B.evaluate(`[...document.querySelectorAll('${card} button')].find(b => b.textContent === 'Deny').click()`);
  assert.equal(await q.answer, 'deny', 'the buttons answer as before');
  await B.viewport(1300, 900);

  // The next card opens the fold as this browser left it; an event from before has its old summary.
  const old = approval.ask({ tool: 'shell', keys: ['shell:ls'], summary: 'ls -la', personId: H.owner.user.id }, {});
  await B.evaluate(`approvalPopup(${JSON.stringify({ id: old.id, tool: 'shell', keys: ['shell:ls'], summary: 'ls -la' })})`);
  assert.equal(await B.evaluate(`document.querySelector('${card} .approval-body').textContent`), 'ls -la', 'an older event draws as it did');
  await B.evaluate(`[...document.querySelectorAll('${card} button')].find(b => b.textContent === 'Deny').click()`);
  await old.answer;
  assert.deepEqual(B.errors, []);
});
