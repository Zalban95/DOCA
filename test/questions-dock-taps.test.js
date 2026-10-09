'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// The dock lets taps through its empty space (pointer-events: none) — so every card in it must take its own back,
// whatever its class: an approval card did not, and a tap on Allow landed on the page beneath (2026-10-09).
test('every card in the questions dock takes its own taps', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'harness.css'), 'utf8');
  assert.match(css, /\.questions-dock\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /\.questions-dock\s*>\s*\*\s*\{\s*pointer-events:\s*auto/);
});
