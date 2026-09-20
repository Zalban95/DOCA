'use strict';

/**
 * The host's shell, whichever host this is.
 *
 * Every one of these used to be a bash assumption that returned ENOENT on
 * Windows — and ENOENT from the agent's most-used tool is not a degraded
 * experience, it is a panel that cannot do anything. So these tests assert
 * behaviour on *this* platform rather than a particular shell's name: they
 * pass on Linux and on Windows, which is the whole property.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const shell = require('../modules/shell');
const { detectBinary } = require('../modules/utils');

test('there is a shell, and it is this platform\'s', () => {
  const s = shell.spec();
  assert.ok(s.file, 'something to spawn');
  assert.ok(Array.isArray(s.args) && s.args.length, 'and the flag that takes a command line');
  if (process.platform === 'win32') {
    assert.match(s.file, /powershell/i);
    // `-Command`, not `/c`: Node's own {shell} option would hand PowerShell
    // `/d /s /c`, which it reads as a path.
    assert.ok(s.args.includes('-Command'));
    assert.ok(s.args.includes('-NoProfile'), 'a profile banner would corrupt the first line of every result');
  } else {
    assert.ok(s.args.includes('-lc'));
  }
});

test('a command runs, and its output comes back', async () => {
  const r = await shell.run('echo doca-shell-probe');
  assert.equal(r.code, 0, `expected a clean exit, got ${r.code}: ${r.out}`);
  assert.match(r.out, /doca-shell-probe/);
  assert.equal(r.error, null);
  assert.equal(r.timedOut, false);
});

test('a failing command is a result, not an exception', async () => {
  // The agent reads this and corrects itself; a throw would kill the turn.
  const r = await shell.run('doca-no-such-command-anywhere');
  assert.notEqual(r.code, 0);
  assert.equal(r.timedOut, false);
  assert.ok(typeof r.out === 'string');
});

test('a command that will not end is killed, and says so', async () => {
  const forever = process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30';
  const r = await shell.run(forever, { timeout: 700 });
  assert.equal(r.timedOut, true, 'the timeout is reported as itself, not as a non-zero exit');
});

test('the working directory is honoured', async () => {
  const tmp = os.tmpdir();
  const pwd = process.platform === 'win32' ? '(Get-Location).Path' : 'pwd';
  const r = await shell.run(pwd, { cwd: tmp });
  assert.equal(r.code, 0);
  // Compared through `path.resolve` because macOS hands back /private/var for
  // /var and Windows is case-insensitive.
  const fold = s => (process.platform === 'win32' ? s.toLowerCase() : s);
  assert.ok(fold(path.resolve(r.out.trim())).includes(fold(path.basename(path.resolve(tmp)))),
    `expected somewhere under ${tmp}, got ${r.out}`);
});

test('the agent is told which shell it has, in words it can act on', () => {
  const said = shell.describe();
  assert.ok(said.length > 10);
  if (process.platform === 'win32') {
    assert.match(said, /PowerShell/);
    // The one mistake a bash-trained model makes first.
    assert.match(said, /&&/, 'it is told the thing it would otherwise get wrong');
  } else {
    assert.match(said, /POSIX/);
  }
});

test('an executable is found by walking PATH, not by asking a shell', () => {
  // node is running this test, so it is on PATH by construction.
  const found = shell.which('node');
  assert.ok(found, 'node is findable');
  assert.ok(path.isAbsolute(found));
  if (process.platform === 'win32')
    assert.match(found, /\.(exe|cmd|bat)$/i, 'PATHEXT is applied — `node` is `node.exe`');

  assert.equal(shell.which('doca-definitely-not-installed'), null);
  // A name with a separator is a path, not something to look up — and looking
  // it up would be a way to probe the filesystem through a PATH walk.
  assert.equal(shell.which('../node'), null);
  assert.equal(shell.which(''), null);
});

test('detectBinary reports a real path and version without a login shell', async () => {
  const r = await detectBinary('node');
  assert.equal(r.detected, true);
  assert.ok(path.isAbsolute(r.path));
  assert.match(r.version || '', /\d+\.\d+/, 'it asked the binary itself');

  const missing = await detectBinary('doca-definitely-not-installed');
  assert.deepEqual(missing, { detected: false, path: null, version: null });
});
