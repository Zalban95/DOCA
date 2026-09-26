'use strict';

/**
 * Every prefs key the code reads is classified as travelling or local
 * (modules/state-map.js, docs/design/state.md), so the split cannot drift.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const { PREFS, DATA } = require('../modules/state-map');
const ROOT = path.join(__dirname, '..');

function sources(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'vendor') out.push(...sources(p)); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('every entry is classified, with a reason', () => {
  for (const [k, v] of Object.entries({ ...PREFS, ...DATA })) {
    assert.ok(['travels', 'local', 'mixed'].includes(v.is), `${k}: ${v.is}`);
    assert.ok(v.note && v.note.length > 5, `${k} says why`);
  }
});

test('every prefs key the code reads or the browser writes is in the map', () => {
  const found = new Set();
  for (const f of [...sources(path.join(ROOT, 'modules')), path.join(ROOT, 'server.js')]) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\b(?:loadPrefs\(\)\??|prefs)\.([a-zA-Z]\w*)/g)) found.add(m[1]);
  }
  for (const f of sources(path.join(ROOT, 'public', 'js'))) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\/api\/prefs'\s*,\s*\{\s*method:\s*'POST',\s*body:\s*\{\s*([a-zA-Z]\w*)/g)) found.add(m[1]);
  }
  const unknown = [...found].filter(k => !(k in PREFS) && !['json'].includes(k));
  assert.deepEqual(unknown, [], 'classify these in modules/state-map.js (travels, local or mixed)');
});
