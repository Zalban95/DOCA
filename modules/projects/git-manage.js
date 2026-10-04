'use strict';

/**
 * Managing a project's repository from the Source control panel (asked for
 * 2026-10-04: "buttons to manage git in the repo section"). git.js stays the
 * reading-and-committing core shared with the agent's `git` tool; this is what
 * was left to a terminal on purpose — starting a repository, remotes, fetch /
 * pull / push, stash, discarding a file's changes — now a click, each with the
 * guard that makes it safe to be one:
 *
 * - discard and pull take a project checkpoint first (checkpoints.js), so the
 *   work they replace is one Restore away, and say so;
 * - network commands run as jobs (they can take a while) with
 *   GIT_TERMINAL_PROMPT=0, so a missing credential fails with git's message
 *   instead of waiting forever for a password nobody can type;
 * - names reach git as validated arguments, never as shell text.
 *
 * These are the person's buttons: the agent's `git` tool does not gain them.
 */
const fs = require('fs');
const path = require('path');
const { git, status } = require('./git');

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const NAME = /^(?!-)[\w./-]{1,100}$/;
const JUNK = ['__pycache__/', '*.pyc', '.pytest_cache/', '.mypy_cache/', '.ruff_cache/', '.venv/', 'venv/', 'node_modules/', '.DS_Store'];

async function init(root, { branch = 'main', commit = false } = {}) {
  if (!NAME.test(branch)) throw bad('Not a branch name.');
  await git(root, ['init', '-b', branch]);
  // Caches and environments are not the project: without this a first "commit everything" took
  // __pycache__ and .venv along (live test 2026-10-04). Only when there is no .gitignore yet.
  const ignore = path.join(root, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, `${JUNK.join('\n')}\n`);
  if (commit) {
    await git(root, ['add', '-A']);
    await git(root, ['commit', '-m', 'Initial commit']).catch(e => { throw bad(`Initialised, but the first commit failed: ${e.message}`); });
  }
  return status(root);
}

async function remotes(root) {
  const out = await git(root, ['remote', '-v']);
  const map = {};
  for (const l of out.split('\n').filter(Boolean)) { const [name, url] = l.split(/\s+/); map[name] = url; }
  return Object.entries(map).map(([name, url]) => ({ name, url }));
}

async function setRemote(root, { name = 'origin', url } = {}) {
  if (!NAME.test(name)) throw bad('Not a remote name.');
  const u = String(url || '').trim();
  if (!u || u.startsWith('-') || /\s/.test(u)) throw bad('A remote URL, like https://github.com/you/repo.git or git@github.com:you/repo.git.');
  const have = (await remotes(root)).some(r => r.name === name);
  await git(root, ['remote', have ? 'set-url' : 'add', name, u]);
  return remotes(root);
}

// Jobs run in bash, or PowerShell on Windows: each quotes single-quoted strings its own way.
const q = s => (process.platform === 'win32' ? `'${String(s).replace(/'/g, "''")}'` : `'${String(s).replace(/'/g, "'\\''")}'`);

/** The command line for fetch / pull / push, run as a job by the route. */
async function syncCommand(root, action) {
  const st = await status(root);
  const rs = await remotes(root);
  if (!rs.length) throw bad('This repository has no remote yet: add one (Remote…) first.');
  if (action === 'fetch') return 'git fetch --all --prune';
  if (action === 'pull') {
    if (!st.upstream) throw bad(`${st.branch} does not track a remote branch yet: push it first.`);
    return 'git pull --ff-only';
  }
  if (action === 'push') {
    if (!st.branch || st.branch === '(detached)') throw bad('Not on a branch.');
    if (!NAME.test(st.branch)) throw bad(`The branch name "${st.branch}" has characters this button will not pass to a shell; push it from a terminal.`);
    return st.upstream ? 'git push' : `git push -u ${q(rs.some(r => r.name === 'origin') ? 'origin' : rs[0].name)} ${q(st.branch)}`;
  }
  throw bad('action is fetch, pull or push.');
}

/** Throw away the working-tree changes of `files` — tracked ones restored, new ones removed. */
async function discard(root, files) {
  const st = await status(root);
  const list = [].concat(files || []).map(String);
  if (!list.length) throw bad('Which files?');
  for (const f of list) {
    const abs = path.resolve(root, f);
    if (!abs.startsWith(path.resolve(root) + path.sep)) throw bad(`${f} is outside the project.`);
    const row = st.files.find(x => x.path === f);
    if (!row) continue;
    if (row.unstaged === '?') fs.rmSync(abs, { force: true });
    else await git(root, ['restore', '--staged', '--worktree', '--', f]);
  }
  return status(root);
}

async function stash(root, { pop = false } = {}) {
  await git(root, pop ? ['stash', 'pop'] : ['stash', 'push', '--include-untracked', '-m', `DOCA ${new Date().toISOString().slice(0, 16)}`]);
  return { ...(await status(root)), stashes: (await git(root, ['stash', 'list'])).split('\n').filter(Boolean).length };
}

async function stashCount(root) {
  try { return (await git(root, ['stash', 'list'])).split('\n').filter(Boolean).length; } catch { return 0; }
}

module.exports = { init, remotes, setRemote, syncCommand, discard, stash, stashCount };
