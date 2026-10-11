'use strict';

/**
 * DOCA's own workspace (2026-10-11): a new install works in ~/doca-workspace; one already working in OpenClaw's
 * folder keeps it until it moves, and the move takes only DOCA's folders, leaving links behind. Each case runs in a
 * child process with a home of its own, because paths.js decides once, when it is loaded.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
function inHome(home, code) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, DOCA_DATA_DIR: path.join(home, 'data'), DOCA_PREFS_FILE: path.join(home, 'prefs.json') };
  for (const k of ['WORKSPACE_DIR', 'ATTACHMENTS_DIR', 'AGENTS_DIR']) delete env[k];
  return JSON.parse(execFileSync(process.execPath, ['-e', code], { cwd: ROOT, env, encoding: 'utf8' }).trim().split('\n').pop());
}
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ws-home-'));
const where = "const p=require('./modules/paths');console.log(JSON.stringify({ws:p.WORKSPACE_DIR,att:p.ATTACHMENTS_DIR,ag:p.AGENTS_DIR}))";

test('a new install works in a workspace of its own', () => {
  const h = home();
  assert.deepEqual(inHome(h, where), { ws: path.join(h, 'doca-workspace'), att: path.join(h, 'doca-workspace', 'attachments'), ag: path.join(h, 'doca-workspace', 'agents') });
});

test('an install already in OpenClaw\'s folder keeps it, and moves only its own folders, leaving links', () => {
  const h = home(), old = path.join(h, '.openclaw', 'workspace');
  fs.mkdirSync(path.join(old, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(old, 'attachments', 'a.png'), 'x');
  fs.writeFileSync(path.join(old, 'SOUL.md'), 'openclaw\'s own');
  assert.equal(inHome(h, where).att, path.join(old, 'attachments'));
  const r = inHome(h, "console.log(JSON.stringify(require('./modules/workspace-move').move()))");
  assert.equal(r.done.attachments, 'moved');
  assert.equal(fs.readFileSync(path.join(h, 'doca-workspace', 'attachments', 'a.png'), 'utf8'), 'x');
  if (process.platform !== 'win32') assert.ok(fs.lstatSync(path.join(old, 'attachments')).isSymbolicLink(), 'the old place links to the new');
  assert.ok(fs.existsSync(path.join(old, 'SOUL.md')), 'OpenClaw\'s own files stay');
  assert.equal(inHome(h, where).att, path.join(h, 'doca-workspace', 'attachments'), 'the next start uses the new one');
  assert.throws(() => inHome(h, "require('./modules/workspace-move').move()"), 'a second move is refused');
});
