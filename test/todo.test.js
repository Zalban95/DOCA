'use strict';

/**
 * TODO.md is the plan of record (CONSTITUTION W5): an item's id names one item, so a commit, a skill or a comment
 * citing it means one thing (audit 2026-10-06, coh F25 — H6.7 named two).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

test('every item id in TODO.md is used once', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'TODO.md'), 'utf8');
  const ids = [...text.matchAll(/^- \[[ x]\] (H\d+\.\d+[a-z]?|[A-E]\d+b?)\b/gm)].map(m => m[1]);
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual([...new Set(twice)], []);
  assert.ok(ids.length > 50, 'the ids were read');
});
