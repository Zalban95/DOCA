'use strict';

// Muted text is body text — section labels, placeholders, page notes — so every palette a person can pick holds it to
// WCAG AA, 4.5:1, on the backgrounds it sits on (self-test round two, #21: Classic's measured 2.75:1 and 2.48:1).

require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const lum = h => {
  const c = [0, 2, 4].map(i => parseInt(h.replace('#', '').slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('every palette\'s muted text reads at 4.5:1 on its page, cards and raised parts', () => {
  const ctx = { document: { documentElement: { dataset: {}, style: { setProperty() {} } } }, localStorage: { getItem: () => null }, window: {} };
  vm.createContext(ctx);
  for (const f of ['themes.js', 'look.js', 'look-points.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8').replace(/^(let|const) /mg, 'var '), ctx, { filename: f });
  const low = [];
  for (const [id, t] of Object.entries(ctx.THEMES)) {
    for (const bg of ['--bg', '--surface', '--raised']) {
      const r = ratio(t.colors['--muted'], t.colors[bg]);
      if (r < 4.5) low.push(`${id}: --muted on ${bg} ${r.toFixed(2)}`);
    }
    if (t.colors['--text-muted']) assert.equal(t.colors['--text-muted'], t.colors['--muted'], `${id}: the two muted tokens agree`);
  }
  assert.deepEqual(low, []);
  assert.ok(Object.keys(ctx.THEMES).length >= 13, 'every palette was read');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'variables.css'), 'utf8');
  assert.equal(css.match(/--muted:\s*(#[0-9a-f]{6})/i)[1].toLowerCase(), ctx.THEMES.default.colors['--muted'].toLowerCase(), 'the page before a theme loads');
});
