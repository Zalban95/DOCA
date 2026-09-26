'use strict';

/**
 * Undo for agent runs (projects/checkpoints.js): a shadow git repository per
 * project, never the project's own.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { execFileSync } = require('node:child_process');

const H        = require('./helpers');
const projects = require('../modules/projects/store');
const cps      = require('../modules/projects/checkpoints');
const tools    = require('../modules/harness/tools');

test.before(() => H.start());
test.after(() => H.stop());

const mk = files => {
  const root = fs.mkdtempSync(path.join(H.tmp, 'cp-'));
  for (const [f, b] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), b); }
  return root;
};
const read = (root, f) => fs.readFileSync(path.join(root, f), 'utf8');

test('a checkpoint and a restore, on a folder that is not a git repository; the restore is itself undoable', async () => {
  const root = mk({ 'a.txt': 'one\n', 'src/b.txt': 'bee\n', 'node_modules/x/index.js': 'dep\n' });
  const p = projects.create({ root, name: 'Plain' });
  const c1 = await cps.take(p, { label: 'before the run' });
  assert.match(c1.id, /^cp_[0-9a-f]{10}$/);
  assert.equal((await cps.take(p)).unchanged, true, 'nothing changed: no new checkpoint');

  // The "agent run": an edit, a new file, a deletion, and a dependency install.
  fs.writeFileSync(path.join(root, 'a.txt'), 'one — edited badly\n');
  fs.writeFileSync(path.join(root, 'new.txt'), 'made by the run\n');
  fs.rmSync(path.join(root, 'src/b.txt'));
  fs.writeFileSync(path.join(root, 'node_modules/x/new.js'), 'installed\n');
  const ch = await cps.changes(p, c1.id);
  assert.deepEqual(ch.map(c => `${c.status} ${c.path}`).sort(), ['A new.txt', 'D src/b.txt', 'M a.txt']);

  const r = await cps.restore(p, c1.id);
  assert.equal(read(root, 'a.txt'), 'one\n');
  assert.equal(read(root, 'src/b.txt'), 'bee\n');
  assert.equal(fs.existsSync(path.join(root, 'new.txt')), false, 'what the run made is gone');
  assert.equal(fs.existsSync(path.join(root, 'node_modules/x/new.js')), true, 'node_modules is not ours to restore');
  assert.ok(r.undo);

  await cps.restore(p, r.undo);
  assert.equal(read(root, 'a.txt'), 'one — edited badly\n', 'and the restore undone');
  assert.equal(read(root, 'new.txt'), 'made by the run\n');
});

test('on a git repository, checkpoints never touch it: no ref, no index, no status change', async () => {
  const root = mk({ 'x.txt': 'x\n' });
  const g = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 'T'); g('add', '.'); g('commit', '-qm', 'one');
  fs.writeFileSync(path.join(root, 'x.txt'), 'changed\n');
  const before = { refs: g('for-each-ref'), status: g('status', '--porcelain') };
  const p = projects.create({ root });
  const c = await cps.take(p, { label: 'here' });
  fs.writeFileSync(path.join(root, 'x.txt'), 'changed again\n');
  await cps.restore(p, c.id);
  assert.equal(read(root, 'x.txt'), 'changed\n');
  assert.equal(g('for-each-ref'), before.refs, 'no ref of ours in their repository');
  assert.equal(g('status', '--porcelain'), before.status);
  assert.ok(!cps.shadowDir(p).startsWith(root), 'the shadow lives in DOCA\'s data folder');
});

test('a project conversation\'s turn takes a checkpoint first; the agent can list, compare and restore', async () => {
  const root = mk({ 'package.json': '{"scripts":{}}', 'app.js': 'v1\n' });
  const p = projects.create({ root, name: 'Agent-run' });
  const sid = projects.workChat(p.id).id;
  const { turnPreamble } = require('../modules/harness/turn/prompt');
  await turnPreamble({ session: require('../modules/harness/memory').getSession(sid), profile: null, p: require('../modules/harness/agent').params() });
  const first = cps.list(p)[0];
  assert.match(first.label, /before a turn of "Project: Agent-run"/);

  fs.writeFileSync(path.join(root, 'app.js'), 'v2 wrong\n');
  const ctx = { sessionId: sid };
  assert.match(await tools.call('project', { action: 'checkpoints' }, [], ctx), new RegExp(first.id));
  assert.match(await tools.call('project', { action: 'changes', checkpoint: first.id }, [], ctx), /M app\.js/);
  assert.match(await tools.call('project', { action: 'restore', checkpoint: first.id }, [], ctx), /Restored .* 1 file\(s\) put back.*To undo this restore: restore cp_/);
  assert.equal(read(root, 'app.js'), 'v1\n');

  const r = await H.api(null, 'GET', `/api/projects/${p.id}/checkpoints`);
  assert.ok(r.body.checkpoints.length >= 2);
});

test('"done" says what the job changed, and what of that its plan did not name', async () => {
  const org = require('../modules/harness/organization');
  const memory = require('../modules/harness/memory');
  const { namedPaths } = require('../modules/projects/finish');
  assert.deepEqual(namedPaths({ title: 'Fix login', steps: ['Change src/auth/login.kt and its test', 'Update README.md.'] }).sort(), ['README.md', 'src/auth/login.kt']);

  const root = mk({ 'src/auth/login.kt': 'old\n', 'src/other.kt': 'x\n', 'README.md': 'r\n' });
  const p = projects.create({ root, name: 'Scoped' });
  const sid = projects.workChat(p.id).id;
  memory.updateSession(sid, { job: { state: 'working', since: new Date(Date.now() - 1000).toISOString() } });
  await org.plan(sid, { action: 'draft', title: 'Fix login', steps: ['Change src/auth/login.kt'] });
  await org.plan(sid, { action: 'progress', step: 1, state: 'done' });
  await cps.beforeTurn(sid);   // the job's first checkpoint
  fs.writeFileSync(path.join(root, 'src/auth/login.kt'), 'new\n');
  fs.writeFileSync(path.join(root, 'src/other.kt'), 'drifted\n');
  await org.tool({ action: 'report', outcome: 'done', message: 'Fixed.' }, { sessionId: sid });
  const brief = memory.getSession(sid).brief;
  assert.match(brief, /Changed during this job \(2\): /);
  assert.match(brief, /Outside what the plan named \(1\): src\/other\.kt/);
});
