'use strict';

/**
 * Every experiment says since when, how it is measured and when it last was (modules/experiments.js; audit 2026-10-06,
 * coh F20, TODO C6): a script that exists, or a write-up that says how a person measures it.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H = require('./helpers');
test.before(() => H.start());
test.after(() => H.stop());

test('each has since, a way to measure that exists, and its last measurement read from its write-up', () => {
  const x = require('../modules/experiments');
  for (const e of x.list()) {
    assert.match(e.since || '', /^\d+\.\d+\.\d+$/, `${e.id} since`);
    assert.ok(['script', 'manual'].includes(e.measure), `${e.id} measure`);
    if (e.measure === 'script') assert.ok(fs.existsSync(path.join(__dirname, '..', 'bin', 'experiments', e.doc.replace(/\.md$/, '.js'))), `${e.id}: its script`);
    else assert.match(e.docText, /## Measured/, `${e.id}: says how it is measured by hand`);
    assert.equal(typeof e.stale, 'boolean');
  }
  assert.equal(x.lastMeasured('| Date | x |\n|---|---|\n| 2026-09-01 | a |\n| 2026-10-06 | b |'), '2026-10-06');
  assert.equal(x.lastMeasured('| — | not measured yet |'), null);
  const wm = x.list().find(e => e.id === 'wakeModel');
  assert.equal(wm.measured, '2026-10-06');
});
