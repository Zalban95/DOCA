'use strict';

/**
 * Type or pick (public/js/lib/choice-input.js; asked 2026-10-08): a box that keeps whatever is typed, with the choices
 * a service offers beside it — loaded only when first opened, asked again with ↻, picked with the keyboard — and a
 * value the service does not list kept as typed and said so, never replaced. In the panel as a browser draws it;
 * skipped where no Chrome, Edge or Chromium is found.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder (see its top)
const B = require('./panel-browser');

before(() => B.start());
after(() => B.stop());

const make = (opts = '') => B.evaluate(`(() => {
  window.__asked = 0;
  document.getElementById('ci-probe')?.remove();
  const host = Object.assign(document.createElement('div'), { id: 'ci-probe' });
  document.body.prepend(host);
  host.innerHTML = choiceInput({ id: 'ci-box', value: 'af_heart', source: 'Kokoro', placeholder: 'a voice',
    load: async () => { window.__asked++; return { items: [{ value: 'af_heart', where: 'served here' }, { value: 'if_sara', label: 'Sara', where: 'served here' }, 'am_adam'], source: 'Kokoro' }; }${opts} });
  return true;
})()`);
const state = () => B.evaluate(`(() => {
  const list = document.getElementById('ci-box-list'), note = document.getElementById('ci-box-note');
  return { value: document.getElementById('ci-box').value, open: !list.hidden, items: [...list.querySelectorAll('.choice-item')].map(i => i.dataset.value),
    active: list.querySelector('.choice-item.active')?.dataset.value || null, note: note.hidden ? '' : note.textContent, asked: window.__asked,
    expanded: document.getElementById('ci-box').getAttribute('aria-expanded') };
})()`);

test('the list is asked for only when first opened, and again with ↻', { skip: B.skip }, async () => {
  await make();
  assert.equal((await state()).asked, 0, 'drawing it asks nothing');
  await B.evaluate("document.getElementById('ci-box').focus()");
  await B.key('ArrowDown');
  await B.until("!document.getElementById('ci-box-list').hidden && !!document.querySelector('#ci-box-list .choice-item')");
  let s = await state();
  assert.deepEqual([s.open, s.expanded, s.items, s.asked], [true, 'true', ['af_heart', 'if_sara', 'am_adam'], 1]);
  assert.match(await B.evaluate("document.querySelector('#ci-box-list .choice-item:nth-child(3)').textContent"), /Sara.*if_sara.*served here/s, 'a label, the value and where it is');
  await B.evaluate("choiceClose('ci-box')");
  await B.evaluate("choiceOpen('ci-box')");
  assert.equal((await state()).asked, 1, 'opened again: the list it has');
  await B.evaluate("document.querySelector('#ci-box-list .choice-refresh').click()");
  await B.until('window.__asked === 2');
  assert.equal((await state()).asked, 2, '↻ asks again');
  await B.key('Escape');
  assert.equal((await state()).open, false, 'Escape closes it');
});

test('the keyboard opens, moves and picks; input and change fire as if typed', { skip: B.skip }, async () => {
  await make();
  await B.evaluate("window.__changes = 0; document.getElementById('ci-box').addEventListener('change', () => window.__changes++); document.getElementById('ci-box').focus()");
  await B.key('ArrowDown');
  await B.until("!!document.querySelector('#ci-box-list .choice-item')");
  await B.key('ArrowDown'); await B.key('ArrowDown');
  assert.equal((await state()).active, 'if_sara');
  await B.key('ArrowUp'); await B.key('ArrowUp');
  assert.equal((await state()).active, 'am_adam', '↑ from the first wraps to the last');
  await B.key('Enter');
  const s = await state();
  assert.deepEqual([s.value, s.open, s.note], ['am_adam', false, '']);
  assert.equal(await B.evaluate('window.__changes'), 1);
  assert.equal(await B.evaluate("document.activeElement.id"), 'ci-box', 'focus stays in the box');
});

test('a value the service does not list is kept as typed, and says so', { skip: B.skip }, async () => {
  await make();
  await B.evaluate("const b = document.getElementById('ci-box'); b.focus(); b.select()");
  await B.evaluate("document.getElementById('ci-box').value = ''");
  await B.evaluate("choiceOpen('ci-box')");
  await B.until("!!document.querySelector('#ci-box-list .choice-item')");
  await B.evaluate("(() => { const b = document.getElementById('ci-box'); b.value = 'my_cloned_voice'; b.dispatchEvent(new Event('input', { bubbles: true })); })()");
  let s = await state();
  assert.deepEqual(s.items, [], 'what is typed filters the list');
  assert.match(await B.evaluate("document.querySelector('#ci-box-list .choice-empty').textContent"), /what you typed is kept/);
  await B.key('Enter');
  s = await state();
  assert.equal(s.value, 'my_cloned_voice', 'Enter with nothing highlighted keeps what is typed');
  assert.equal(s.note, 'not offered by Kokoro — kept as typed');
  // Typing part of a listed one narrows the list to it.
  await B.evaluate("(() => { const b = document.getElementById('ci-box'); b.value = 'sar'; b.dispatchEvent(new Event('input', { bubbles: true })); choiceOpen('ci-box'); })()");
  assert.deepEqual((await state()).items, ['if_sara'], 'matched by its label too');
  await B.key('Escape');
});

test('a list known when drawn says at once that a value is not on it', { skip: B.skip }, async () => {
  const note = await B.evaluate(`(() => {
    const host = document.getElementById('ci-probe');
    host.innerHTML = choiceInput({ id: 'ci-known', value: 'ghost', items: ['af_heart'], source: 'Qwen3-TTS' });
    return document.getElementById('ci-known-note').textContent;
  })()`);
  assert.equal(note, 'not offered by Qwen3-TTS — kept as typed');
});

test('an existing box becomes one where it stands, keeping its id, value and handlers', { skip: B.skip }, async () => {
  const r = await B.evaluate(`(async () => {
    const host = document.getElementById('ci-probe');
    host.innerHTML = '<div style="display:flex"><input class="input" id="ci-old" style="flex:1" value="http://127.0.0.1:8880" onchange="window.__old = this.value"></div>';
    const box = choiceInputAttach(document.getElementById('ci-old'), { source: 'this machine', load: async () => [{ value: 'http://127.0.0.1:8881', where: 'served here' }] });
    await choiceOpen('ci-old');
    document.querySelector('#ci-old-list .choice-item').click();
    return { same: box === document.getElementById('ci-old'), wrapped: !!box.closest('.choice'), flex: box.closest('.choice').style.flex, value: box.value, heard: window.__old,
      again: choiceInputAttach(box, { source: 'x' }) === box && document.querySelectorAll('#ci-probe .choice').length };
  })()`);
  assert.deepEqual(r, { same: true, wrapped: true, flex: '1 1 0%', value: 'http://127.0.0.1:8881', heard: 'http://127.0.0.1:8881', again: 1 });
  assert.deepEqual(B.errors, [], 'no page error');
});
