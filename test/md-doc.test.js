'use strict';

// A project's markdown file resolves its own images and links, and nothing outside the project (projects/md-doc.js).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read } = require('./frontend');

const ctx = vm.createContext({});
vm.runInContext(read('projects/md-doc.js'), ctx);
const resolve = (from, rel, root) => vm.runInContext(`_pjMdResolve(${JSON.stringify(from)}, ${JSON.stringify(rel)}, ${JSON.stringify(root)})`, ctx);

test('a relative path resolves against the file\'s folder, inside the project only', () => {
  assert.equal(resolve('/p/docs/README.md', 'img/a.png', '/p'), '/p/docs/img/a.png');
  assert.equal(resolve('/p/docs/README.md', '../logo.png', '/p'), '/p/logo.png');
  assert.equal(resolve('/p/README.md', './a%20b.png', '/p'), '/p/a b.png');
  assert.equal(resolve('/p/README.md', '../../etc/passwd', '/p'), null, 'climbing out of the project is refused');
  assert.equal(resolve('/p/README.md', '../p-other/x.png', '/p'), null, 'a sibling whose name starts like the root is outside');
  assert.equal(resolve('/p/README.md', 'x.png', ''), null, 'no project, nothing resolves');
});

test('Windows paths, either separator, any case', () => {
  assert.equal(resolve('D:\\doca\\proj\\README.md', 'docs/a.png', 'D:\\doca\\proj'), 'D:\\doca\\proj\\docs\\a.png');
  assert.equal(resolve('D:\\doca\\proj\\README.md', '..\\..\\x.png', 'd:\\doca\\proj'), null);
});

test('a malformed %-escape is taken as written, not a thrown error (audit 2026-10-04)', () => {
  assert.equal(resolve('/p/README.md', 'a%zz.png', '/p'), '/p/a%zz.png');
});
