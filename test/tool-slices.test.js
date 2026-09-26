'use strict';

/**
 * Two faults the agent reported in its own tools (settings proposals of
 * 2026-09-26): search/replace given one file matched nothing, and read_file had
 * no way to read on and described a slice as a failed read.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H     = require('./helpers');
const tools = require('../modules/harness/tools');

test.before(() => H.start());
test.after(() => H.stop());

const dir = () => { const d = path.join(H.tmp, `slices-${Math.random().toString(36).slice(2, 7)}`); fs.mkdirSync(path.join(d, 'sub'), { recursive: true }); return d; };

test('replace_in_files and search_files take one file as well as a folder', async () => {
  const d = dir();
  const file = path.join(d, 'a.txt');
  fs.writeFileSync(file, 'alpha beta\nalpha\n');
  fs.writeFileSync(path.join(d, 'sub', 'a.txt'), 'alpha elsewhere\n');   // same name deeper: must not be touched

  assert.match(await tools.call('search_files', { query: 'alpha', path: file }), /a\.txt:1:1/);
  const dry = await tools.call('replace_in_files', { query: 'alpha', replacement: 'omega', path: file });
  assert.match(dry, /Would replace 2 occurrence\(s\) in 1 file\(s\)/);
  const done = await tools.call('replace_in_files', { query: 'alpha', replacement: 'omega', path: file, apply: true });
  assert.match(done, /^Replaced 2 occurrence\(s\) in 1 file\(s\)\./);
  assert.equal(fs.readFileSync(file, 'utf8'), 'omega beta\nomega\n');
  assert.equal(fs.readFileSync(path.join(d, 'sub', 'a.txt'), 'utf8'), 'alpha elsewhere\n');

  assert.match(await tools.call('replace_in_files', { query: 'x', replacement: 'y', path: path.join(d, 'nope.txt'), apply: true }), /^Error: Nothing at .*nope\.txt/,
    'a path that is not there is an error, not "0 occurrences"');
});

test('read_file reads a slice, says which, and says where to read on', async () => {
  const d = dir();
  const file = path.join(d, 'long.md');
  fs.writeFileSync(file, 'x'.repeat(100) + 'MIDDLE' + 'y'.repeat(100));
  const first = await tools.call('read_file', { path: file, maxLength: 100 });
  assert.match(first, /\[characters 1–100 of 206; 106 more — read on with offset 100\]/);
  const next = await tools.call('read_file', { path: file, offset: 100, maxLength: 6 });
  assert.match(next, /\nMIDDLE\n… \[characters 101–106 of 206/);
  assert.match(await tools.call('read_file', { path: file, offset: 200 }), /yyyyyy\n… \[characters 201–206 of 206; that is the end of the file\]/);
  assert.match(await tools.call('read_file', { path: file, offset: 500 }), /at or past the end: the file has 206 characters/);
  assert.doesNotMatch(await tools.call('read_file', { path: file }), /characters 1–/, 'a whole file has no notice');
});
