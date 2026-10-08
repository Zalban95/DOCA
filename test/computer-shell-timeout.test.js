'use strict';

/**
 * A computer's shell answers by its timeout at the latest, whatever the command started (self-test round two, B3):
 * a backgrounded process held the output pipes open, so the call waited for ever, and the timeout killed only bash.
 * The command now has a process group of its own, killed whole at the timeout. The computer is Linux; this runs
 * where bash and process groups are (not Windows).
 */
require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const skip = process.platform === 'win32' && 'the computer is Linux; Windows has no process groups to kill';

test('a command that backgrounds a process answers when the command ends, and says the rest is not read', { skip }, async () => {
  const { run } = require('../clients/computer/tools');
  const t = Date.now();
  const r = await run('bash', ['-c', 'sleep 5 & echo started'], { timeoutSec: 20 });
  assert.ok(Date.now() - t < 4000, `it answered in ${Date.now() - t} ms, not when the background sleep ended`);
  assert.equal(r.code, 0);
  assert.match(r.out, /^started\n/);
  assert.match(r.out, /a process it started is still running and holds its output open/);
});

test('at its timeout the command and everything it started are ended, and what it wrote is kept', { skip }, async () => {
  const { run } = require('../clients/computer/tools');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'computer-shell-'));
  const late = path.join(dir, 'late');
  const t = Date.now();
  const r = await run('bash', ['-c', `echo before; (sleep 2; touch '${late}') & sleep 30`], { timeoutSec: 1 });
  assert.ok(Date.now() - t < 3000, `it answered at its timeout (${Date.now() - t} ms)`);
  assert.equal(r.code, null);
  assert.match(r.out, /^before\n/);
  assert.match(r.out, /stopped after 1 s: the command and everything it started were ended/);
  await new Promise(res => setTimeout(res, 2500));
  assert.ok(!fs.existsSync(late), 'the background process was ended with the group, not left to run');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a plain command answers with its exit code and output, no note', { skip }, async () => {
  const { run } = require('../clients/computer/tools');
  const r = await run('bash', ['-c', 'echo hi; exit 3'], { timeoutSec: 5 });
  assert.deepEqual(r, { code: 3, out: 'hi\n' });
});
