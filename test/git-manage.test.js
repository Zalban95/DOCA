'use strict';

// Managing a project's repository from the panel: init, remote, push/pull, discard, stash (projects/git-manage.js).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const H = require('./helpers');
const projects = require('../modules/projects/store');
const jobs = require('../modules/harness/jobs');

Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
let p, root, bare;
const api = (m, url, body) => H.api(null, m, `/api/projects/${p.id}/git${url}`, body);
const done = async id => { for (let i = 0; i < 100; i++) { const j = jobs.get(id); if (j.state !== 'running') return j; await H.sleep(100); } throw new Error('job did not end'); };

before(async () => {
  await H.start();
  root = fs.mkdtempSync(path.join(H.tmp, 'gm-'));
  bare = fs.mkdtempSync(path.join(H.tmp, 'remote-'));
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare]);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  p = projects.create({ root, name: 'Git buttons' });
});
after(() => H.stop());

test('a folder becomes a repository, with its files as the first commit', async () => {
  const r = await api('POST', '/init', { commit: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.branch, 'main');
  assert.match(execFileSync('git', ['-C', root, 'log', '--oneline']).toString(), /Initial commit/);
});

test('push without a remote says to add one; with one, the first push publishes the branch', async () => {
  const none = await api('POST', '/sync', { action: 'push' });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /no remote yet/);
  const rem = await api('POST', '/remote', { url: bare });
  assert.deepEqual(rem.body.remotes, [{ name: 'origin', url: bare }]);
  const push = await api('POST', '/sync', { action: 'push' });
  assert.equal(push.body.command.run, "git push -u 'origin' 'main'");
  assert.equal((await done(push.body.job.id)).code, 0);
  assert.match(execFileSync('git', ['-C', bare, 'log', '--oneline', 'main']).toString(), /Initial commit/);
  const again = await api('POST', '/sync', { action: 'push' });
  assert.equal(again.body.command.run, 'git push', 'upstream set: a plain push');
  await done(again.body.job.id);
});

test('pull takes a checkpoint first and fast-forwards', async () => {
  const other = fs.mkdtempSync(path.join(H.tmp, 'clone-'));
  execFileSync('git', ['clone', '-q', bare, other]);
  fs.writeFileSync(path.join(other, 'b.txt'), 'from elsewhere\n');
  execFileSync('git', ['-C', other, 'add', '.']); execFileSync('git', ['-C', other, 'commit', '-qm', 'remote change']); execFileSync('git', ['-C', other, 'push', '-q']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one — local edit\n');
  const pull = await api('POST', '/sync', { action: 'pull' });
  assert.ok(pull.body.checkpoint, 'a checkpoint before pulling');
  assert.equal((await done(pull.body.job.id)).code, 0);
  assert.equal(fs.readFileSync(path.join(root, 'b.txt'), 'utf8'), 'from elsewhere\n');
});

test('discard restores a tracked file and removes a new one, after a checkpoint that holds them', async () => {
  fs.writeFileSync(path.join(root, 'new.txt'), 'scratch\n');
  const r = await api('POST', '/discard', { files: ['a.txt', 'new.txt'] });
  assert.equal(r.status, 200);
  assert.ok(r.body.checkpoint);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'one\n');
  assert.equal(fs.existsSync(path.join(root, 'new.txt')), false);
  await require('../modules/projects/checkpoints').restore(p, r.body.checkpoint);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'one — local edit\n', 'and the checkpoint brings them back');
  assert.equal((await api('POST', '/discard', { files: ['../outside'] })).status, 400);
});

test('stash puts changes aside and pop brings them back', async () => {
  const s = await api('POST', '/stash', {});
  assert.equal(s.body.stashes, 1);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'one\n');
  await api('POST', '/stash', { pop: true });
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'one — local edit\n');
  assert.equal((await api('POST', '/remote', { url: '--upload-pack=evil' })).status, 400, 'a URL cannot be an option');
});
