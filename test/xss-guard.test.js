'use strict';

// An error message is text: it never reaches innerHTML unescaped (audit 2026-10-04).
// The server echoes paths in errors (EACCES … '<img src=x onerror=…>'), so a folder name could run script.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { files, read } = require('./frontend');

test('no innerHTML is built from an unescaped error message', () => {
  const bad = [];
  for (const f of files()) {
    read(f).split('\n').forEach((line, i) => {
      if (/innerHTML/.test(line) && /\$\{\s*(e|err|error)\.message\s*\}/.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [], 'wrap it in escHtml(), or use textContent');
});
