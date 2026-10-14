'use strict';

/**
 * A toast never covers an open dialog's controls (found by a newcomer, 2026-10-14: "… asked every screen to load
 * again. This page loads again once the open question is answered — or now: Reload ✕" sat over the folder picker's
 * Select, so the question it waited on could not be answered). In the panel as a browser draws it: with a dialog open
 * the toasts step to the top, or under the dialog when it fills the screen; ✕ on the reload notice puts it away for
 * good, and the page still reloads once it is free.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');   // first: it points the settings at a temporary folder
const B = require('./panel-browser');

before(() => B.start({ setup: B.pastFirstRun }));
after(() => B.stop());

/** Whether every control of the folder picker is the topmost thing where it is drawn. */
const pickerFree = `(() => [...document.querySelectorAll('#fp-modal button, #fp-modal input')].filter(b => b.offsetParent).every(b => {
  const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return top && (top === b || b.contains(top));
}))()`;

test('a toast steps aside from an open dialog, and ✕ puts the reload notice away', { skip: B.skip }, async () => {
  for (const [w, h] of [[1280, 680], [390, 800], [1300, 900]]) {
    await B.viewport(w, h);
    await B.open();
    await B.evaluate(`fpPick({ mode: 'dir' }); pageReloadSoon('Someone asked every screen to load again.'); undoToast?.('Put away "x".', () => {}); true`);
    assert.ok(await B.until(`document.querySelectorAll('#undo-toasts .undo-toast').length >= 1 && /open question/.test(document.getElementById('undo-toasts').textContent)`), `the notice waits on the picker (${w})`);
    await B.sleep(300);
    assert.ok(await B.until(pickerFree, 3000), `the picker's Select and Cancel are not covered (${w})`);
    // ✕ puts it away, and the re-check does not bring it back.
    await B.evaluate(`document.querySelector('#undo-toasts .page-reload .undo-x').click(); true`);
    assert.equal(await B.evaluate(`!!document.querySelector('#undo-toasts .page-reload')`), false, 'gone at once');
    await B.evaluate(`pageReloadSoon('Someone asked every screen to load again.'); true`);
    assert.equal(await B.evaluate(`!!document.querySelector('#undo-toasts .page-reload')`), false, 'and not drawn again while the page waits');
    await B.evaluate(`fpClose(); document.querySelectorAll('#undo-toasts .undo-toast').forEach(t => t.remove()); clearTimeout(_prTimer); true`);
    assert.ok(await B.until(`document.getElementById('undo-toasts').className === 'undo-toasts'`, 3000), 'the dialog closed: back in place');
  }
  assert.deepEqual(B.errors, []);
});
