'use strict';

// Parallel work on one repository (modules/projects/worktrees.js, TODO H7.3): a conversation in its own git
// worktree works there — its tools, its named commands, its brief — while the main folder is left alone.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const H = require('./helpers');

let repo;
before(async () => {
  await H.start();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-wt-'));
  const g = (...a) => execFileSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  g('add', '.'); g('commit', '-qm', 'first');
});
after(async () => { await H.stop(); fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(`${repo}.worktrees`, { recursive: true, force: true }); });

test('a tab in its own worktree works there; the main folder and another tab do not see its changes', async () => {
  const projects = require('../modules/projects/store');
  const p = projects.create({ root: repo, name: 'wt' });
  const made = await H.api(null, 'POST', `/api/projects/${p.id}/chats`, { worktree: true });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const wt = made.body.chat.worktree;
  assert.ok(fs.existsSync(path.join(wt.path, 'a.txt')), 'the worktree holds the repository');
  assert.match(wt.branch, /^doca\//);
  const tools = require('../modules/harness/tools');
  await tools.call('write_file', { path: 'b.txt', content: 'from the worktree\n' }, [], { sessionId: made.body.chat.id });
  assert.ok(fs.existsSync(path.join(wt.path, 'b.txt')), 'a relative path lands in the worktree');
  assert.ok(!fs.existsSync(path.join(repo, 'b.txt')), 'the main folder is untouched');
  const other = projects.newChat(p.id);
  assert.equal(require('../modules/harness/toolbox/common').cwd({ sessionId: other.id }), repo, 'another tab works in the main folder');
  const brief = await require('../modules/projects/brief').forSession(made.body.chat.id);
  assert.match(brief, new RegExp(`own git worktree of .*on branch ${wt.branch.replace('/', '\\/')}`));
  const listed = (await H.api(null, 'GET', `/api/projects/${p.id}/chats`)).body.chats.find(c => c.id === made.body.chat.id);
  assert.equal(listed.worktree, wt.branch);
});

test('status counts its commits; removing refuses uncommitted work, and keeps the branch', async () => {
  const projects = require('../modules/projects/store');
  const p = projects.create({ root: repo, name: 'wt2' });
  const chat = projects.newChat(p.id);
  const worktrees = require('../modules/projects/worktrees');
  const wt = await worktrees.create(chat.id, { branch: 'feature/x' });
  fs.writeFileSync(path.join(wt.path, 'c.txt'), 'c\n');
  await assert.rejects(worktrees.remove(chat.id), /uncommitted/);
  execFileSync('git', ['add', '.'], { cwd: wt.path });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'c'], { cwd: wt.path });
  assert.deepEqual([(await worktrees.status(chat.id)).commits, (await worktrees.status(chat.id)).uncommitted], [1, 0]);
  const r = await worktrees.remove(chat.id);
  assert.equal(r.branch, 'feature/x');
  assert.ok(!fs.existsSync(wt.path));
  assert.match(execFileSync('git', ['branch', '--list', 'feature/x'], { cwd: repo }).toString(), /feature\/x/, 'the branch stays');
  assert.equal(require('../modules/harness/toolbox/common').cwd({ sessionId: chat.id }), repo, 'back in the main folder');
});
