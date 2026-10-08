'use strict';
// A version's node_modules linked from one with the same dependencies (modules/link-tree.js): was GNU `cp -al`, which
// neither Windows nor macOS has (H1.9). Runs on every CI runner, so each OS's own hard links are what is checked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { linkTree } = require('../modules/link-tree');

test('a tree is hard-linked whole: files, folders, dot files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linktree-'));
  const src = path.join(root, 'a', 'node_modules'), dest = path.join(root, 'b', 'node_modules');
  fs.mkdirSync(path.join(src, 'pkg', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(src, '.package-lock.json'), '{}');
  fs.writeFileSync(path.join(src, 'pkg', 'lib', 'index.js'), 'module.exports = 1;');
  const r = linkTree(src, dest);
  assert.deepEqual(r, { linked: 2, copied: 0 });
  assert.equal(fs.readFileSync(path.join(dest, 'pkg', 'lib', 'index.js'), 'utf8'), 'module.exports = 1;');
  assert.ok(fs.existsSync(path.join(dest, '.package-lock.json')), 'npm\'s own marker comes too: releases.hasDeps reads it');
  assert.equal(fs.statSync(path.join(dest, 'pkg', 'lib', 'index.js')).ino, fs.statSync(path.join(src, 'pkg', 'lib', 'index.js')).ino, 'the same file, not a copy');
  fs.rmSync(root, { recursive: true, force: true });
});

test('where a link cannot be made the file is copied, and a symbolic link stays one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linktree-'));
  const src = path.join(root, 'a'), dest = path.join(root, 'b');
  fs.mkdirSync(path.join(src, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(src, 'x.js'), 'x');
  let canSymlink = true;
  try { fs.symlinkSync('../x.js', path.join(src, 'bin', 'x')); } catch { canSymlink = false; }   // Windows without the right to make one
  const r = linkTree(src, dest, { link: () => { throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' }); } });
  assert.equal(r.copied, 1);
  assert.equal(fs.readFileSync(path.join(dest, 'x.js'), 'utf8'), 'x');
  if (canSymlink) assert.equal(fs.readlinkSync(path.join(dest, 'bin', 'x')), '../x.js');
  fs.rmSync(root, { recursive: true, force: true });
});
