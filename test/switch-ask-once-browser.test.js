'use strict';

/**
 * The same question is asked once however many requests meet it, nothing is asked while Flow warms pages, and a
 * device on the local network is told so plainly (2026-10-15: a phone on the Wi-Fi had to close the same message
 * again and again). In a real browser; skipped where no Chrome, Edge or Chromium is found.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const B = require('./panel-browser');

before(() => B.start({ setup: B.pastFirstRun }));
after(() => B.stop());

const lan = { code: 'switch_off', message: 'off', needs: { what: 'Managing this machine from the local network', setting: 'network.lanAdmin', route: null, mayChange: false } };

test('one question for many requests; the local network said plainly; nothing asked while warming', { skip: B.skip }, async () => {
  const r = await B.evaluate(`(() => {
    const e = ${JSON.stringify(lan)};
    const a = switchAskWait(e), b = switchAskWait(e), c = switchAskWait(e);
    const shown = document.querySelectorAll('.switch-ask').length;
    const text = document.querySelector('.switch-ask')?.textContent || '';
    document.querySelector('.switch-ask [data-act="no"]').click();
    return Promise.all([a, b, c]).then(v => ({ shown, text, answers: v, left: document.querySelectorAll('.switch-ask').length }));
  })()`);
  assert.equal(r.shown, 1, 'asked once');
  assert.match(r.text, /This device is on the local network/);
  assert.match(r.text, /over Tailscale/);
  assert.deepEqual(r.answers, [false, false, false], 'one answer for every request');
  assert.equal(r.left, 0);
  const warming = await B.evaluate(`(() => { _flowWarming = true; const p = switchAskWait(${JSON.stringify(lan)}); const n = document.querySelectorAll('.switch-ask').length; _flowWarming = false; return p.then(v => ({ n, v })); })()`);
  assert.deepEqual(warming, { n: 0, v: false }, 'warming asks nothing');
});
