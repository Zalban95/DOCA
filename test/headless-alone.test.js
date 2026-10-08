'use strict';
// Every headless browser DOCA starts stays DOCA's (modules/headless.js ALONE): on Windows, Edge with a fresh profile
// signed in to the person's Microsoft account and synced their extensions into it (H1.9, a real Windows 11 host).
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const fs = require('node:fs');
const path = require('node:path');
const { ALONE } = require('../modules/headless');

test('no sign-in and no sync, at every place a headless browser is started', () => {
  assert.ok(ALONE.includes('--disable-sync'));
  assert.ok(ALONE.some(f => /^--disable-features=.*\bmsImplicitSignin\b/.test(f)));
  const root = path.join(__dirname, '..');
  const files = ['modules', 'bin'].flatMap(d => fs.readdirSync(path.join(root, d), { recursive: true }).map(f => path.join(d, f)))
    .filter(f => f.endsWith('.js') && fs.readFileSync(path.join(root, f), 'utf8').includes("'--headless=new'"));
  assert.ok(files.length >= 3, `the smoke, the machines' pictures and the page check: ${files.join(', ')}`);
  for (const f of files) assert.match(fs.readFileSync(path.join(root, f), 'utf8'), /'--headless=new'[^\]]*\.\.\.(h\.)?ALONE/, f);
});
