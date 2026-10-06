'use strict';

/** Every font the panel draws text in is the theme's (variables.css: --font-ui, --font-mono, --font-text,
 *  --font-display), so a skin or a custom theme reaches all of it (audit 2026-10-06). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
// On purpose: the Modern skin's preview tile shows that skin's face while another is on; a font file's preview shows
// that font; a concept's glyph is drawn in the emoji fonts.
const ALLOWED = [/look-tile-modern/, /font-family:\$\{family\}/, /Emoji/];

test('no rule or inline style names a font family instead of the theme\'s variables', () => {
  const bad = [];
  for (const f of files(PUBLIC).filter(f => /\.(css|js|html)$/.test(f) && !f.includes(`${path.sep}vendor${path.sep}`))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/font-family\s*:\s*([^;"`]+)|\bfont\s*:\s*[^;"`]*?(['"][A-Z][^'"]+['"])/g)) {
        const v = (m[1] || m[2] || '').trim();
        if (!v || /^(var\(--font|inherit)/.test(v) || ALLOWED.some(a => a.test(line))) continue;
        bad.push(`${path.relative(PUBLIC, f)}:${i + 1}: ${v.slice(0, 60)}`);
      }
    });
  }
  assert.deepEqual(bad, []);
});

test('the variables every rule names are defined', () => {
  const vars = fs.readFileSync(path.join(PUBLIC, 'css', 'variables.css'), 'utf8');
  for (const v of ['--font-ui', '--font-mono', '--font-text', '--font-display']) assert.match(vars, new RegExp(`${v}\\s*:`), v);
});
