'use strict';

/**
 * Checkpoints: go back to how a project was before an agent run, and try again.
 *
 * A shadow git repository per project, in DOCA's data folder, whose work tree
 * is the project folder: `git --git-dir <shadow> --work-tree <root>`. So it
 * works on a folder that is not a git repository, and on one that is it never
 * touches that repository — no branch, no index, no ref of ours appears in the
 * person's `git log --all`. Git never descends into a `.git` folder, and the
 * shadow's own excludes skip what nobody means to restore (node_modules, build
 * output…), on top of the project's .gitignore.
 *
 *   take(project, { label, sessionId })  a checkpoint — skipped when nothing
 *                                        changed since the last one
 *   list(project)                        newest first
 *   changes(project, id)                 what differs between it and now
 *   restore(project, id)                 the tree as it was; files made since
 *                                        are removed. A checkpoint is taken
 *                                        first, so a restore can be undone too.
 *
 * Taken automatically when a conversation bound to the project starts a turn
 * (and only if the tree changed), and by hand from the Projects tab or the
 * agent's `project` tool.
 */
const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const store = require('../store');
const shell = require('../shell');
const { SKIP_DIRS } = require('./search');

const KEEP = 60;   // checkpoints kept per project; older ones are dropped from the list (git gc reclaims them)

function shadowDir(p) { return path.join(store.dir('checkpoints'), `${p.id}.git`); }

function git(p, args, { timeout = 120000, input } = {}) {
  const bin = shell.which('git');
  if (!bin) return Promise.reject(Object.assign(new Error('Checkpoints need git on this machine.'), { status: 501 }));
  return new Promise((resolve, reject) => {
    const child = execFile(bin, ['--git-dir', shadowDir(p), '--work-tree', p.root, '-c', 'core.quotepath=off', ...args],
      { timeout, maxBuffer: 32 << 20, windowsHide: true, env: { ...process.env, GIT_AUTHOR_NAME: 'DOCA', GIT_AUTHOR_EMAIL: 'doca@localhost', GIT_COMMITTER_NAME: 'DOCA', GIT_COMMITTER_EMAIL: 'doca@localhost' } },
      (err, stdout, stderr) => (err ? reject(Object.assign(new Error(String(stderr || err.message).trim().split('\n')[0]), { status: 400 })) : resolve(String(stdout))));
    if (input != null) { child.stdin.write(input); child.stdin.end(); }
  });
}

async function ensure(p) {
  const dir = shadowDir(p);
  if (fs.existsSync(path.join(dir, 'HEAD'))) return;
  await git(p, ['init', '-q']);   // --git-dir + --work-tree: a normal (not bare) repository whose files are the project's
  fs.mkdirSync(path.join(dir, 'info'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'info', 'exclude'), [...SKIP_DIRS].map(d => `${d}/`).join('\n') + '\n');
}

function rows(p) { return store.readJson(`checkpoints/${p.id}`, { checkpoints: [] }).checkpoints; }
function save(p, list) { store.writeJson(`checkpoints/${p.id}`, { checkpoints: list.slice(-KEEP) }); }

/** The project's current tree, written into the shadow's object store: its tree hash. */
async function snapshotTree(p) {
  await ensure(p);
  const index = path.join(shadowDir(p), 'doca-index');
  const env = { GIT_INDEX_FILE: index };
  const bin = shell.which('git');
  const run = args => new Promise((resolve, reject) => execFile(bin, ['--git-dir', shadowDir(p), '--work-tree', p.root, ...args],
    { env: { ...process.env, ...env }, maxBuffer: 32 << 20, timeout: 300000, windowsHide: true },
    (err, out, se) => (err ? reject(new Error(String(se || err.message).trim().split('\n')[0])) : resolve(String(out).trim()))));
  await run(['add', '-A', '--', '.']);
  return run(['write-tree']);
}

/** Take a checkpoint. Returns it, or the last one when nothing changed since. */
async function take(p, { label = 'checkpoint', sessionId = null, by = 'person' } = {}) {
  const tree = await snapshotTree(p);
  const list = rows(p);
  const last = list.at(-1);
  if (last && last.tree === tree) return { ...last, unchanged: true };
  const parent = last ? ['-p', last.commit] : [];
  const commit = (await git(p, ['commit-tree', tree, ...parent, '-m', String(label).slice(0, 200)])).trim();
  await git(p, ['update-ref', 'refs/heads/checkpoints', commit]);
  const files = last ? (await git(p, ['diff', '--name-only', last.tree, tree])).split('\n').filter(Boolean).length : null;
  const cp = { id: `cp_${commit.slice(0, 10)}`, commit, tree, label: String(label).slice(0, 200), sessionId, by,
    at: new Date().toISOString(), changedSincePrevious: files };
  save(p, [...list, cp]);
  return cp;
}

function list(p) { return rows(p).slice().reverse(); }

function need(p, id) {
  const cp = rows(p).find(c => c.id === id);
  if (!cp) throw Object.assign(new Error(`No checkpoint ${id} in ${p.name}.`), { status: 404 });
  return cp;
}

/** Files that differ between a checkpoint and the project now: [{ status, path }] (A = made since, D = gone since). */
async function changes(p, id) {
  const cp = need(p, id);
  const now = await snapshotTree(p);
  const out = await git(p, ['diff', '--name-status', '--no-renames', cp.tree, now]);
  return out.split('\n').filter(Boolean).map(l => { const [status, ...rest] = l.split('\t'); return { status, path: rest.join('\t') }; });
}

/** One file's change since a checkpoint, as a unified diff. */
async function fileDiff(p, id, file) {
  const cp = need(p, id);
  const now = await snapshotTree(p);
  return git(p, ['diff', cp.tree, now, '--', file]);
}

/**
 * Put the project back as it was at `id`. A checkpoint of the present is taken
 * first ("before restoring …"), so this can be undone the same way.
 */
async function restore(p, id, { sessionId = null, by = 'person' } = {}) {
  const cp = need(p, id);
  const before = await take(p, { label: `before restoring ${cp.id} (${cp.label})`, sessionId, by });
  const diff = await changes(p, id);
  // Files made since the checkpoint go; everything it had comes back as it was.
  for (const d of diff.filter(x => x.status === 'A')) fs.rmSync(path.join(p.root, d.path), { force: true });
  await git(p, ['read-tree', cp.tree], {});
  await git(p, ['checkout-index', '-a', '-f']);
  return { restored: cp, undo: before.unchanged ? null : before.id, removed: diff.filter(x => x.status === 'A').length,
    reverted: diff.filter(x => x.status !== 'A').length };
}

/**
 * Before a project's conversation starts a turn: a checkpoint, only if the tree
 * changed since the last one. Never throws — a turn is not held up by it.
 */
async function beforeTurn(sessionId) {
  try {
    const p = require('./store').forSession(sessionId);
    if (!p || !fs.existsSync(p.root)) return null;
    const title = require('../harness/memory').getSession(sessionId)?.title || sessionId;
    return await take(p, { label: `before a turn of "${String(title).slice(0, 60)}"`, sessionId, by: 'panel' });
  } catch { return null; }
}

module.exports = { take, list, changes, fileDiff, restore, beforeTurn, shadowDir };
