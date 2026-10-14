'use strict';

/**
 * Flow in a real browser (public/js/flow/*, css/flow.css; docs/design/flow-experience.md). Standard first: the panel
 * exactly as it was — no mark, no rail, no movement. Then Flow on this screen: the opening warms the pages and goes,
 * a warmed page is drawn at once where a cold one waited on the hub, every page still opens with no page error, the
 * rail shows the person's groups, a phone gets chips and a bar that opens groups straight away, and a screen asking
 * for reduced motion never moves. Skipped where no Chrome is found.
 */
require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const B = require('./panel-browser');

before(() => B.start({ setup: B.pastFirstRun }));
after(() => B.stop());

/** ms from nav() until the Models page's disk strip is drawn from the hub (no longer "Checking disk space…"). */
const MODELS_DRAWN = `(async () => {
  const t0 = performance.now(); nav('models');
  window.__waited = !!document.querySelector('#models-disk-strip .pulse');
  while (document.querySelector('#models-disk-strip .pulse') && performance.now() - t0 < 15000) await new Promise(r => requestAnimationFrame(r));
  return performance.now() - t0;
})()`;
const anim = sel => `getComputedStyle(document.querySelector(${JSON.stringify(sel)})).animationName`;
let coldStandard;

test('Standard is the panel as it was', { skip: B.skip, timeout: 120000 }, async () => {
  assert.equal(await B.evaluate('document.documentElement.dataset.experience ?? null'), null);
  assert.equal(await B.evaluate("!!document.getElementById('flow-rail')"), false, 'no rail');
  assert.equal(await B.evaluate("getComputedStyle(document.querySelector('header .nav-tabs')).display !== 'none'"), true, 'the groups across the top');
  await B.evaluate("nav('harness')");
  assert.equal(await B.evaluate(anim('#tab-harness')), 'none', 'no movement');
  coldStandard = await B.evaluate(MODELS_DRAWN);
  assert.equal(await B.evaluate('window.__waited'), true, `the Models page waited ${Math.round(coldStandard)} ms for the hub on its first visit`);
  assert.deepEqual(B.errors, []);
});

test('Flow: the opening warms the pages and goes; a warmed page is drawn at once', { skip: B.skip, timeout: 120000 }, async () => {
  await B.evaluate("screenSave({ experience: { mode: 'flow' } }).then(() => sessionStorage.clear())");
  await B.open();
  assert.equal(await B.evaluate('document.documentElement.dataset.experience'), 'flow');
  assert.ok(await B.until('typeof _flowWarm !== "undefined" && _flowWarm && _flowWarm.finished', 25000), 'warming finished');
  assert.ok(await B.until("!document.getElementById('flow-opening')", 6000), 'the opening went');
  const warmed = await B.evaluate('_flowWarm.done.slice()');
  assert.ok(warmed.includes('models'), `models warmed (${warmed})`);
  const warm = await B.evaluate(MODELS_DRAWN);
  assert.ok(warm < coldStandard, `warm ${Math.round(warm)} ms < cold ${Math.round(coldStandard)} ms`);
  assert.equal(await B.evaluate('window.__waited'), false, `drawn as it opened, with nothing to wait for (${Math.round(warm)} ms)`);
  assert.ok(await B.until("/opened in \\d+ ms · warm/.test(document.getElementById('flow-readout').textContent)", 3000), 'the readout says it opened warm');
});

test('Flow: every page opens with no page error, and moves in', { skip: B.skip, timeout: 240000 }, async () => {
  const tabs = await B.evaluate('NAV_TABS.slice()');
  for (const t of tabs) {
    await B.evaluate(`nav(${JSON.stringify(t)})`);
    await B.sleep(t === 'settings' ? 900 : 300);
    assert.equal(await B.evaluate(`document.getElementById('tab-${t}').classList.contains('active')`), true, t);
  }
  await B.evaluate("nav('harness')"); await B.evaluate("nav('teams')");
  assert.equal(await B.evaluate(anim('#tab-teams')), 'flow-page-in', 'a page within its group lifts');
  await B.evaluate("nav('models')");
  assert.equal(await B.evaluate(anim('#tab-models')), 'flow-group-in', 'another group slides');
  assert.deepEqual(B.errors, []);
});

test('Flow: the rail is the person\'s groups; a phone has chips and a bar that opens groups at once', { skip: B.skip, timeout: 60000 }, async () => {
  const rail = await B.evaluate("[...document.querySelectorAll('#flow-rail .flow-rail-item')].map(b => b.dataset.group)");
  assert.deepEqual(rail, await B.evaluate('NAV_GROUPS.filter(g => _navShownIn(g).length).map(g => g.id).filter(g => g !== "settings").concat("settings")'));
  assert.equal(await B.evaluate("getComputedStyle(document.querySelector('header .nav-tabs')).display"), 'none', 'the groups moved to the rail');
  await B.viewport(390, 844);
  await B.evaluate("nav('harness')");
  assert.equal(await B.evaluate("getComputedStyle(document.getElementById('nav-pages')).display"), 'flex', 'the group\'s pages as chips');
  await B.evaluate("navGroupTap('machines', document.querySelector('.mobile-nav-item[data-group=machines]'))");
  assert.equal(await B.evaluate("!!document.getElementById('nav-group-menu')"), false, 'no menu: the group opened');
  assert.equal(await B.evaluate("NAV_GROUPS.find(g => g.id === 'machines').tabs.includes(currentTab)"), true);
  await B.viewport(1300, 900);
});

test('Flow: a screen asking for reduced motion never moves, nor with Motion none', { skip: B.skip, timeout: 60000 }, async () => {
  await B.media([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await B.evaluate("nav('harness')"); await B.evaluate("nav('models')");
  assert.equal(await B.evaluate(anim('#tab-models')), 'none');
  assert.equal(await B.evaluate("document.querySelectorAll('.flow-leaving').length"), 0, 'the old page is gone at once');
  await B.media([]);
  await B.evaluate("experienceSave({ motion: 'none' })");
  await B.evaluate("nav('harness')");
  assert.equal(await B.evaluate(anim('#tab-harness')), 'none');
  await B.evaluate("experienceSave({ mode: 'standard' })");
  assert.equal(await B.evaluate('document.documentElement.dataset.experience ?? null'), null, 'one click back');
  assert.equal(await B.evaluate("!!document.getElementById('flow-rail')"), false);
  assert.deepEqual(B.errors, []);
});
