'use strict';

/**
 * New controls look like the old ones.
 *
 * The version picker shipped in 2.54.0 as a bare <select>, drawn by the
 * browser's default style in the middle of a panel where every other field is
 * `.input`. Nothing looked for it. This does: every text field, textarea and
 * select in the page and in the markup the scripts build carries the panel's
 * own class — `.input`, or `.editor` for the two code editors.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const frontend = require('./frontend');

const SOURCES = [
  ['index.html', fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8')],
  ['login.html', fs.readFileSync(path.join(__dirname, '..', 'public', 'login.html'), 'utf8')],
  ...frontend.files().map(f => [f, frontend.read(f)]),
];

/** Inputs that are not text fields have looks of their own. */
const NOT_A_FIELD = /type="(checkbox|radio|range|hidden|file|color)"/;

test('every field, textarea and select uses the panel\'s own class', () => {
  const bare = [];
  for (const [file, src] of SOURCES) {
    for (const [tag] of src.matchAll(/<(select|textarea|input)\b[^>]*>/g)) {
      if (NOT_A_FIELD.test(tag)) continue;
      if (!/class="[^"]*\b(input|editor)\b/.test(tag)) bare.push(`${file}: ${tag.slice(0, 90)}`);
    }
  }
  assert.deepEqual(bare, [], 'give it class="input" (and flex1 to stretch), like every other field');
});
