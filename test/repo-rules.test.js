'use strict';

/**
 * Charter rules 16 and 22, held in code: a repository's own rules are read
 * before the first write into it, and a write leaves no `.bak` in its tree.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { execFileSync } = require('node:child_process');

const H         = require('./helpers');   // isolated DOCA_DATA_DIR, WORKSPACE_DIR under /tmp
const repo      = require('../modules/harness/repo');
const tools     = require('../modules/harness/tools');
const providers = require('../modules/harness/providers');

let n = 0;
/** A fresh repository under the test's temp dir, with the given files. */
function makeRepo(files = {}, { git = false } = {}) {
  const root = path.join(H.tmp, `repo-${process.pid}-${++n}`);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  if (git) {
    fs.rmSync(path.join(root, '.git'), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
  }
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), text);
  }
  return root;
}

test('the root is the nearest directory holding .git, and a path outside any repository has none', () => {
  const root = makeRepo({ 'src/a.js': '' });
  assert.equal(repo.rootOf(path.join(root, 'src', 'a.js')), root);
  assert.equal(repo.rootOf(path.join(root, 'src', 'not-yet.js')), root, 'a file about to be created');
  const loose = fs.mkdtempSync(path.join(H.tmp, 'loose-'));
  assert.equal(repo.rootOf(loose), null);
});

test('rule files: the root\'s own, .cursor/rules, then nested ones outermost first', () => {
  const root = makeRepo({
    'CONTRIBUTING.md': 'c', 'AGENTS.md': 'a', '.cursor/rules/style.mdc': 's', '.cursor/rules/notes.txt': 'x',
    'packages/web/AGENTS.md': 'w', 'packages/AGENTS.md': 'p', 'other/AGENTS.md': 'o',
  });
  assert.deepEqual(repo.ruleFiles(root, path.join(root, 'packages', 'web', 'App.tsx')), [
    'AGENTS.md', 'CONTRIBUTING.md', path.join('.cursor', 'rules', 'style.mdc'),
    path.join('packages', 'AGENTS.md'), path.join('packages', 'web', 'AGENTS.md'),
  ], 'a sibling folder\'s rules do not govern this file, and a .txt in .cursor/rules is not a rule');
});

test('write_file refuses a repository with rules until repo_rules has been read, in this conversation only', async () => {
  const root = makeRepo({ 'AGENTS.md': 'Use tabs. Never touch vendor/.' });
  const file = path.join(root, 'index.js');
  const ctx = { sessionId: 'conv-a' };

  const refused = await tools.call('write_file', { path: file, content: 'x' }, [], ctx);
  assert.match(refused, /^Error: .*has not read them\. Call repo_rules/);
  assert.equal(fs.existsSync(file), false, 'nothing was written');

  const brief = await tools.call('repo_rules', { path: file }, [], ctx);
  assert.match(brief, /## AGENTS\.md\nUse tabs\. Never touch vendor\//);

  assert.match(await tools.call('write_file', { path: file, content: 'x' }, [], ctx), /^Wrote 1 bytes/);
  assert.match(await tools.call('write_file', { path: file, content: 'y' }, [], { sessionId: 'conv-b' }),
    /has not read them/, 'another conversation has not read them');
});

test('a repository without rule files, or no repository, never blocks', async () => {
  const bare = makeRepo({});
  assert.match(await tools.call('write_file', { path: path.join(bare, 'a.txt'), content: 'x' }, [], { sessionId: 's' }), /^Wrote/);
  const loose = fs.mkdtempSync(path.join(H.tmp, 'loose-'));
  assert.match(await tools.call('write_file', { path: path.join(loose, 'a.txt'), content: 'x' }, [], { sessionId: 's' }), /^Wrote/);
});

test('inside a repository the previous version is kept, but outside the tree', async () => {
  const root = makeRepo({ 'AGENTS.md': 'rules', 'a.txt': 'old' });
  const ctx = { sessionId: 'bak' };
  await tools.call('repo_rules', { path: root }, [], ctx);
  const out = await tools.call('write_file', { path: path.join(root, 'a.txt'), content: 'new' }, [], ctx);

  assert.equal(fs.existsSync(path.join(root, 'a.txt.bak')), false, 'no .bak in the working tree (rule 22)');
  const kept = out.match(/previous version kept at (.+)\)$/)[1];
  assert.equal(fs.readFileSync(kept, 'utf8'), 'old', 'but the way back exists (rule 4)');
  assert.ok(!kept.startsWith(root), 'and it is outside the repository');

  const loose = fs.mkdtempSync(path.join(H.tmp, 'loose-'));
  fs.writeFileSync(path.join(loose, 'b.txt'), 'old');
  await tools.call('write_file', { path: path.join(loose, 'b.txt'), content: 'new' }, [], ctx);
  assert.equal(fs.readFileSync(path.join(loose, 'b.txt.bak'), 'utf8'), 'old', 'outside a repository nothing changed');
});

test('the brief names the default branch as one not to work on, and shows uncommitted work', async () => {
  const root = makeRepo({ 'AGENTS.md': 'rules' }, { git: true });
  const git = (...a) => execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a]);
  git('add', '.'); git('commit', '-qm', 'init');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  fs.writeFileSync(path.join(root, 'theirs.txt'), 'someone else\'s work');

  const brief = repo.brief('git-brief', root);
  assert.match(brief, /Branch: main \(default: main\) — this is the default branch/);
  assert.match(brief, /Uncommitted changes already present \(1\).*\n\?\? theirs\.txt/);
});

test('the charter carries the repository rules, and names the tool that enforces the first', () => {
  const c = providers.SAFETY_CHARTER;
  assert.match(c, /## Working on a repository/);
  for (const n of [16, 17, 18, 19, 20, 21, 22, 23]) assert.match(c, new RegExp(`^${n}\\. `, 'm'), `rule ${n}`);
  assert.match(c, /`repo_rules`/);
  assert.match(c, /Never push, force-push, tag, merge or open a pull request without asking first/);
});

test('a specialist allowed to write is also given repo_rules, and one that is not allowed to write is not', () => {
  const { disabledFor } = require('../modules/harness/turn/prompt');
  const p = { disabledTools: [] };
  assert.equal(disabledFor({ tools: ['read_file', 'write_file'] }, p).includes('repo_rules'), false,
    'write_file would send it to a tool it did not have');
  assert.equal(disabledFor({ tools: ['read_file'] }, p).includes('repo_rules'), true);
});
