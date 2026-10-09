'use strict';

/**
 * Parallel work on one repository (TODO H7.3; what Cursor and Claude Code do with worktrees): a conversation can
 * work in its own git worktree — a second working folder of the same repository, on its own branch — so two work
 * chats changing the same project do not edit each other's files. The worktree is a fact about the conversation
 * (`session.worktree`); every tool resolves its folder through projects/store.forSession, which hands the
 * conversation, its missions and its work chats the worktree's folder as the project's root.
 *
 * It sits beside the repository (`<repo>.worktrees/<branch>`), inside the same allowed root as the repository
 * itself and outside its tree, so `git status` in the main folder stays clean. Merging the branch back is the
 * person's call (or a git step the agent asks for); removing refuses uncommitted work unless told.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const git = (cwd, args) => new Promise((resolve, reject) => execFile(require('../shell').which('git') || 'git', args, { cwd, timeout: 60000, windowsHide: true },
  (err, stdout, stderr) => (err ? reject(bad(String(stderr || err.message).trim().split('\n').pop(), 409)) : resolve(String(stdout).trim()))));

function projectOf(sessionId) {
  const memory = require('../harness/memory');
  const s = memory.getSession(sessionId);
  if (!s) throw bad('No such conversation.', 404);
  const p = require('./store').forSession(sessionId);
  if (!p) throw bad('This conversation is not in a project.');
  return { s, p };
}

/**
 * A worktree of the repository at `dir` on a new branch `branch` from `base` (default HEAD) — the one way a worktree
 * is made, by a conversation (create) or a team's task (teams/place.js). A branch or folder already taken gets -2, -3….
 */
async function add(dir, { branch, base = null } = {}) {
  const root = await git(dir, ['rev-parse', '--show-toplevel']).catch(() => { throw bad(`${dir} is not a git repository.`); });
  const want = String(branch || 'doca/work').replace(/[^\w./-]/g, '-').replace(/\/+$/, '').slice(0, 60);
  const taken = async (name, at) => fs.existsSync(at) || await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]).then(() => true, () => false);
  let name = want, at = path.join(`${root}.worktrees`, want.replace(/\//g, '-'));
  for (let n = 2; await taken(name, at) && n < 50; n++) { name = `${want}-${n}`; at = path.join(`${root}.worktrees`, name.replace(/\//g, '-')); }
  if (!require('../utils').fmSafe(at)) throw bad(`${at} is outside the allowed roots.`);
  const from = await git(dir, ['rev-parse', base || 'HEAD']);   // HEAD of the folder asked for: a worktree's own
  fs.mkdirSync(path.dirname(at), { recursive: true });
  await git(root, ['worktree', 'add', '-b', name, at, from]);
  return { path: at, branch: name, base: from, repo: root, createdAt: new Date().toISOString() };
}

/** Give this conversation its own worktree, on a new branch from the main folder's HEAD. */
async function create(sessionId, { branch } = {}) {
  const { s, p } = projectOf(sessionId);
  if (s.worktree?.path && fs.existsSync(s.worktree.path)) return s.worktree;
  const wt = await add(p.mainRoot || p.root, { branch: branch || `doca/${sessionId.slice(-6)}` });
  require('../harness/memory').updateSession(sessionId, { worktree: wt });
  require('./brief').forget(p.id);
  return wt;
}

/** How far it is: commits on the branch since it started, and what is not committed yet. */
async function status(sessionId) {
  const { s } = projectOf(sessionId);
  const wt = s.worktree;
  if (!wt?.path) return null;
  if (!fs.existsSync(wt.path)) return { ...wt, gone: true };
  const ahead = Number(await git(wt.path, ['rev-list', '--count', `${wt.base}..HEAD`]).catch(() => '0'));
  const dirty = (await git(wt.path, ['status', '--porcelain']).catch(() => '')).split('\n').filter(Boolean);
  return { ...wt, commits: ahead, uncommitted: dirty.length };
}

/** Remove the worktree (its branch stays, with its commits); refuses uncommitted work unless `force`. */
async function remove(sessionId, { force = false } = {}) {
  const st = await status(sessionId);
  if (!st) throw bad('This conversation has no worktree of its own.', 404);
  if (!st.gone) {
    if (st.uncommitted && !force) throw bad(`${st.uncommitted} uncommitted change(s) in ${st.path}: commit them, or remove with force to drop them.`, 409);
    await git(st.repo, ['worktree', 'remove', ...(force ? ['--force'] : []), st.path]);
  }
  require('../harness/memory').updateSession(sessionId, { worktree: null });
  return { removed: st.path, branch: st.branch, commits: st.commits || 0 };
}

module.exports = { add, create, status, remove };
