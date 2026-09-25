'use strict';

/**
 * The three in-app dialogs, clicked.
 *
 * Every confirmation in the panel goes through appConfirm, so a fault there
 * breaks every destructive action at once — and one did, briefly: an edit meant
 * for appPrompt's cleanup landed in appConfirm's too, where `opts` does not
 * exist, so pressing OK threw and the action never ran. Nothing clicked OK, so
 * nothing noticed. This does, for each dialog, against a small fake DOM.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const frontend = require('./frontend');

function el(id) {
  const classes = new Set();
  return { id, value: '', type: 'text', textContent: '', className: '', style: {}, onclick: null, onkeydown: null,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    focus() {}, select() {} };
}

function load() {
  const ids = ['app-confirm-modal', 'app-confirm-message', 'app-confirm-ok', 'app-confirm-cancel',
    'app-prompt-modal', 'app-prompt-message', 'app-prompt-input', 'app-prompt-ok', 'app-prompt-cancel'];
  const dom = Object.fromEntries(ids.map(i => [i, el(i)]));
  const sandbox = { document: { getElementById: i => dom[i] || null }, setTimeout: fn => fn(), console };
  vm.createContext(sandbox);
  vm.runInContext(frontend.source('lib/dialogs.js'), sandbox);
  return { ...sandbox, dom };
}

test('appConfirm runs the action on OK, the other one on Cancel, and closes', () => {
  const { appConfirm, dom } = load();
  let ran = '';
  appConfirm('Delete it?', () => { ran = 'ok'; }, () => { ran = 'cancel'; });
  assert.equal(dom['app-confirm-modal'].classList.contains('open'), true);
  dom['app-confirm-ok'].onclick();
  assert.equal(ran, 'ok');
  assert.equal(dom['app-confirm-modal'].classList.contains('open'), false);

  appConfirm('Again?', () => { ran = 'ok2'; }, () => { ran = 'cancel'; });
  dom['app-confirm-cancel'].onclick();
  assert.equal(ran, 'cancel');
});

test('appAlert closes on OK and calls back', () => {
  const { appAlert, dom } = load();
  let closed = false;
  appAlert('Done.', () => { closed = true; });
  dom['app-confirm-ok'].onclick();
  assert.equal(closed, true);
  assert.equal(dom['app-confirm-cancel'].style.display, '', 'the cancel button is back for the next confirm');
});

test('appPrompt trims an answer, and a secret one is masked, kept whole, and wiped after', () => {
  const { appPrompt, dom } = load();
  let got = null;
  appPrompt('Name?', v => { got = v; });
  dom['app-prompt-input'].value = '  padded  ';
  dom['app-prompt-ok'].onclick();
  assert.equal(got, 'padded');

  appPrompt('Password?', v => { got = v; }, '', { secret: true });
  assert.equal(dom['app-prompt-input'].type, 'password');
  dom['app-prompt-input'].value = ' spaces count ';
  dom['app-prompt-ok'].onclick();
  assert.equal(got, ' spaces count ', 'a password is not trimmed');
  assert.equal(dom['app-prompt-input'].value, '', 'nor left in the field');
  assert.equal(dom['app-prompt-input'].type, 'text', 'and the next prompt is not masked');
});
