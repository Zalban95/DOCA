'use strict';
// A restart and a version switch start DOCA again the same way (modules/relaunch.js): the install's launcher, never
// `bash run.sh` (Windows has none — H1.9), detached and hidden, and the server it starts hidden too.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const { command } = require('../modules/relaunch');

test('the install\'s launcher, run by this node, and the server it starts is hidden', () => {
  const c = command({ home: '/srv/doca', node: '/usr/bin/node' });
  assert.equal(c.file, '/usr/bin/node');
  assert.deepEqual(c.args.slice(-1), ['start']);
  assert.match(c.args[0], /doca-launch\.js$/);
  assert.ok(!c.args.some(a => /run\.sh|bash/.test(a)), 'no shell script in between');
  // Started without a console, the server got its own, which Windows Terminal shows as a window that stops DOCA when closed.
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'bin', 'doca-launch.js'), 'utf8');
  assert.match(src, /spawn\(process\.execPath, \['server\.js'\], \{[^}]*windowsHide: true/);
});

test('neither restart path names bash any more', () => {
  const fs = require('node:fs'), path = require('node:path');
  for (const f of ['update.js', 'releases.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'modules', f), 'utf8');
    assert.doesNotMatch(src, /spawn\(\s*['"]bash['"]|\['bash',/, f);
  }
});
