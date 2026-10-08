'use strict';

/**
 * Relative paths land in the workspace the agent is told about (deep test B, C4): on a fresh install nothing made the
 * workspace, so `notes/today.md` was written into the home folder.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H = require('./helpers');
const common = require('../modules/harness/toolbox/common');

test('the workspace is made the first time it is needed', () => {
  const dir = path.join(H.tmp, 'fresh', 'workspace');
  assert.ok(!fs.existsSync(dir));
  assert.equal(common.workspace(dir), dir);
  assert.ok(fs.statSync(dir).isDirectory());
});

test('a relative path resolves against the working folder, and a result says where it went', () => {
  const abs = common.resolvePath('notes/today.md');
  assert.equal(abs, path.join(common.cwd(), 'notes', 'today.md'));
  assert.equal(common.landed('notes/today.md', abs), `\n[notes/today.md is ${abs}]`);
  assert.equal(common.landed(abs, abs), '');
  assert.equal(common.landed('~/x', '/h/x'), '');
});

test('read_file of a relative path names the file it read', async () => {
  const tools = require('../modules/harness/tools');
  fs.writeFileSync(path.join(common.cwd(), 'ws-note.txt'), 'hello');
  const out = await tools.call('read_file', { path: 'ws-note.txt' }, [], {});
  assert.match(String(out), /hello\n\[ws-note\.txt is .*ws-note\.txt\]/);
});
