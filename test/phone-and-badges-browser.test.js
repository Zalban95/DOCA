'use strict';

/**
 * What a newcomer met on a fresh install (run 1, 2026-10-14), in a real headless browser: on a phone the chat button is
 * not under a banner, the hub's sentences wrap, Settings' pill row says it has more; at a desk no Advanced fold is
 * marked changed before anything was changed, its count says what it counts, and a theme's name is not cut.
 * Skipped where no Chrome, Edge or Chromium is found.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');   // first: it points the settings at a temporary folder
const B = require('./panel-browser');

before(() => B.start({ setup: B.pastFirstRun }));
after(() => B.stop());

const LONG = 'no GPU tool found (nvidia-smi, rocm-smi, xpu-smi); inference still runs on the CPU, slowly, and a remote provider still answers';

test('on a phone: the chat button is not under the reload banner', { skip: B.skip }, async () => {
  await B.viewport(390, 844);
  await B.evaluate("nav('settings'); settingsSubNav('general')");
  await B.sleep(500);
  const top = await B.evaluate(`(() => {
    _prShow('Someone asked every screen to load again. This page loads again once what you typed is saved — or now:', true);
    // Where the button sits at home: stepping aside from a control (lib/fab-aside.js) is another matter.
    const f = document.getElementById('chat-fab');
    f.style.transition = 'none'; document.body.classList.remove('fab-aside');
    const r = f.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const bar = document.querySelector('.undo-toast.page-reload').getBoundingClientRect();
    f.style.transition = '';
    return { onFab: !!t && f.contains(t), what: t?.className, barBottom: bar.bottom, fabTop: r.top };
  })()`);
  await B.evaluate("document.querySelector('.undo-toast.page-reload')?.remove()");
  assert.ok(top.onFab, `a press on the chat button reaches it, not "${top.what}"`);
  assert.ok(top.barBottom <= top.fabTop, `the banner ends (${top.barBottom}) above the button (${top.fabTop})`);
});

