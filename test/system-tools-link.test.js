'use strict';

/**
 * "Settings → System → System tools" links take a person there (newcomer run 2026-10-14, a12): the section, with the
 * System tools card brought into view — and choosing a Settings section scrolls only the pill row sideways, never the
 * page, which used to undo the link by scrolling back up to the pill. Run in a sandbox; the scrolling itself was
 * checked in Chromium (the card's top lands under the header).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('sysdepsShow opens Settings → System and brings the System tools card into view', () => {
  const calls = [];
  const card = { scrollIntoView: o => calls.push(['scroll', o.block]) };
  const ctx = { settingsSubNav: id => calls.push(['section', id]), setTimeout: fn => fn(),
    document: { getElementById: id => (id === 'sysdeps-list' ? { closest: sel => (sel === '.card' ? card : null) } : null) } };
  vm.createContext(ctx);
  vm.runInContext(read('js/settings/sysdeps.js'), ctx);
  ctx.sysdepsShow();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['section', 'system'], ['scroll', 'start'], ['scroll', 'start']]);
});

test('every button that names System tools goes there by sysdepsShow', () => {
  assert.match(read('js/models.js'), /onclick="sysdepsShow\(\)">Settings → System → System tools</);
  assert.match(read('js/lib/pty-banner.js'), /onclick="sysdepsShow\(\)">Open Settings → System → System tools</);
});

test('a Settings section\'s pill is centred in its row, sideways only', () => {
  const src = read('js/settings/subnav.js');
  assert.doesNotMatch(src, /btn\.scrollIntoView/, 'scrollIntoView also scrolls the page up to the pill');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.match(/function _settingsPillCentre[\s\S]*?\n}\n/)[0], ctx);
  let to = null;
  const row = { scrollWidth: 600, clientWidth: 300, scrollLeft: 0, getBoundingClientRect: () => ({ left: 0 }), scrollTo: o => { to = o; } };
  ctx._settingsPillCentre({ parentElement: row, getBoundingClientRect: () => ({ left: 400, width: 80 }) });
  assert.deepEqual(JSON.parse(JSON.stringify(to)), { left: 290, behavior: 'smooth' });
  to = null;
  ctx._settingsPillCentre({ parentElement: { ...row, scrollWidth: 300 }, getBoundingClientRect: () => ({ left: 0, width: 80 }) });
  assert.equal(to, null, 'a row that fits is left alone');
});
