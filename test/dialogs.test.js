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
  // The confirm modal's row of buttons, for appChoose: its children are Cancel and OK, and it takes new buttons.
  const actions = { children: [dom['app-confirm-cancel'], dom['app-confirm-ok']], added: [],
    appendChild(b) { this.added.push(b); }, querySelectorAll() { const a = this.added; return { forEach: f => { a.splice(0).forEach(f); } }; } };
  dom['app-confirm-modal'].querySelector = () => actions;
  const keys = new Set();
  const document = { getElementById: i => dom[i] || null, querySelectorAll: () => [],
    addEventListener: (t, f) => { if (t === 'keydown') keys.add(f); }, removeEventListener: (t, f) => keys.delete(f),
    createElement: () => ({ style: {}, onclick: null, remove() {} }) };
  const press = key => { for (const f of [...keys]) f({ key, defaultPrevented: false, preventDefault() {}, stopPropagation() {} }); };
  const sandbox = { document, setTimeout: fn => fn(), console, press, actions };
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

// Deep test B (C6): Escape did nothing on a confirmation, and a choice had no way out but picking.
test('Escape cancels a confirmation, closes a notice, and cancels a prompt wherever the focus is', () => {
  const { appConfirm, appAlert, appPrompt, dom, press } = load();
  let ran = '';
  appConfirm('Stop the server?', () => { ran = 'ok'; }, () => { ran = 'cancel'; });
  press('Escape');
  assert.equal(ran, 'cancel');
  assert.equal(dom['app-confirm-modal'].classList.contains('open'), false);
  press('Escape');
  assert.equal(ran, 'cancel', 'a closed dialog no longer listens');
  let closed = false;
  appAlert('Done.', () => { closed = true; });
  press('Escape');
  assert.equal(closed, true);
  let cancelled = false;
  appPrompt('Name?', () => {}, '', { onCancel: () => { cancelled = true; } });
  press('Escape');
  assert.equal(cancelled, true);
});

test('appChoose shows Cancel when the choices have none; Cancel and Escape close it without picking', () => {
  const { appChoose, dom, press, actions } = load();
  let picked = 'nothing';
  appChoose('When?', [{ label: 'Every hour', value: 60 }, { label: 'Daily', value: 'd' }], v => { picked = v; });
  assert.equal(dom['app-confirm-cancel'].style.display, '', 'its Cancel is shown');
  assert.equal(dom['app-confirm-ok'].style.display, 'none');
  dom['app-confirm-cancel'].onclick();
  assert.equal(picked, 'nothing');
  assert.equal(dom['app-confirm-modal'].classList.contains('open'), false);
  appChoose('When?', [{ label: 'Every hour', value: 60 }], v => { picked = v; });
  press('Escape');
  assert.equal(picked, 'nothing');
  appChoose('When?', [{ label: 'Every hour', value: 60 }], v => { picked = v; });
  actions.added[0].onclick();
  assert.equal(picked, 60);
  // A caller's own Cancel choice is what Escape picks.
  appChoose('Restart?', [{ label: 'Cancel', value: undefined }, { label: 'Now', value: false }], v => { picked = `got ${v}`; });
  assert.equal(dom['app-confirm-cancel'].style.display, 'none', 'no second Cancel');
  press('Escape');
  assert.equal(picked, 'got undefined');
});
