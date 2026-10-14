'use strict';

/**
 * An ⓘ button is named after what it explains (newcomer run 2026-10-14, b3): forty of them were all "What this is".
 * Run in a sandbox with a small stand-in for the elements the upgrade reads.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function el(tag, text, kids = [], cls = '') {
  const e = { tagName: tag, classList: { contains: c => cls.split(' ').includes(c) }, dataset: {}, attrs: {}, childNodes: kids,
    setAttribute(k, v) { this.attrs[k] = v; }, closest: () => null };
  Object.defineProperty(e, 'textContent', { get: () => text ?? kids.map(k => k.textContent).join('') });
  return e;
}

test('an info button takes its label\'s words, never a button\'s or a list\'s', () => {
  const ctx = { _uiEsc: s => s, uiIcon: () => '' };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'lib', 'field-info.js'), 'utf8'), ctx);
  const btn = el('BUTTON', '', [], 'info-btn');
  const label = el('LABEL', null, [{ textContent: '  Models   folder ' }, el('SELECT', 'a b c'), el('BUTTON', '↺ Check'), btn]);
  btn.closest = () => label;
  const lone = el('BUTTON', '', [], 'info-btn');
  ctx.fieldInfoUpgrade({ querySelectorAll: sel => (sel.startsWith('.info-btn') ? [btn, lone] : []) });
  assert.equal(btn.attrs['aria-label'], 'What “Models folder” is');
  assert.equal(btn.title, 'What “Models folder” is');
  assert.equal(lone.attrs['aria-label'], undefined, 'nothing to name it by: it keeps "What this is"');
});
