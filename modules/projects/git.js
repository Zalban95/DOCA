'use strict';

/**
 * Git, for a project: the same operations behind the Projects tab's source
 * control panel and the agent's `git` tool — one set of operations, two faces.
 *
 * git is run directly with its arguments (execFile, no shell), so a file name
 * or a commit message is never parsed as a command. Reading is free; changing
 * (stage, unstage, commit, checkout a branch) is what the host right and, for
 * the agent, the approval mode are for. Nothing here pushes, rewrites history
 * or discards work: those stay deliberate, in a terminal.
 */
const path = require('path');
const { execFile } = require('child_process');

const shell = require('../shell');

const MAX = 8 << 20;

function git(root, args, { timeout = 20000 } = {}) {
  const bin = shell.which('git');
  if (!bin) return Promise.reject(Object.assign(new Error('git is not installed on this machine.'), { status: 501 }));
  return new Promise((resolve, reject) => {
    execFile(bin, ['-C', root, '-c', 'core.quotepath=off', ...args], { timeout, maxBuffer: MAX, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(new Error(String(stderr || err.message).trim().split('\n').slice(0, 3).join(' ')), { status: 400 }));
      resolve(String(stdout));
    });
  });
}

/** Is `root` inside a git work tree? Its top level, or null. */
async function top(root) {
  try { return (await git(root, ['rev-parse', '--show-toplevel'])).trim(); } catch { return null; }
}

/** Branch, upstream, ahead/behind, and every changed file with its state. */
async function status(root) {
  const out = await git(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
  const r = { branch: null, upstream: null, ahead: 0, behind: 0, files: [] };
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const l = parts[i];
    if (!l) continue;
    if (l.startsWith('# branch.head ')) r.branch = l.slice(14);
    else if (l.startsWith('# branch.upstream ')) r.upstream = l.slice(18);
    else if (l.startsWith('# branch.ab ')) { const [a, b] = l.slice(12).split(' '); r.ahead = Math.abs(+a); r.behind = Math.abs(+b); }
    else if (l[0] === '1' || l[0] === '2') {
      const f = l.split(' ');
      const xy = f[1];
      const file = l[0] === '1' ? f.slice(8).join(' ') : f.slice(9).join(' ');
      const from = l[0] === '2' ? parts[++i] : undefined;   // a rename carries its old path next
      r.files.push({ path: file, from, staged: xy[0] !== '.' ? xy[0] : null, unstaged: xy[1] !== '.' ? xy[1] : null });
    } else if (l[0] === '?') r.files.push({ path: l.slice(2), staged: null, unstaged: '?' });
    else if (l[0] === 'u') r.files.push({ path: l.split(' ').slice(10).join(' '), staged: 'U', unstaged: 'U', conflict: true });
  }
  return r;
}

/** Commits, newest first; for one file when `file` is given (following renames). */
async function log(root, { file, limit = 50, rev } = {}) {
  const args = ['log', `-n${Math.min(500, Number(limit) || 50)}`, '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%D%x1e'];
  if (rev) args.push(String(rev));
  if (file) args.push('--follow', '--', file);
  const out = await git(root, args);
  return out.split('\x1e').map(s => s.trim()).filter(Boolean).map(s => {
    const [hash, short, author, date, subject, refs] = s.split('\x1f');
    return { hash, short, author, date, subject, refs: refs ? refs.split(', ').filter(Boolean) : [] };
  });
}

/** Branches, local and remote, with the current one marked. */
async function branches(root) {
  const out = await git(root, ['branch', '-a', '--format=%(HEAD)%x1f%(refname:short)%x1f%(objectname:short)%x1f%(committerdate:iso-strict)']);
  return out.split('\n').filter(Boolean).map(l => { const [h, name, hash, date] = l.split('\x1f'); return { name, hash, date, current: h === '*' }; });
}

/**
 * A unified diff: the working tree against HEAD (or `rev`), staged changes with
 * `staged`, or one commit with `commit`. Optionally for one file.
 */
async function diff(root, { file, rev, staged = false, commit } = {}) {
  const args = commit ? ['show', '--format=', commit] : ['diff', ...(staged ? ['--cached'] : []), ...(rev ? [rev] : [])];
  if (file) args.push('--', file);
  return git(root, args);
}

/** A file as it was at `rev` (HEAD by default) — what the compare view puts on the left. */
async function show(root, file, rev = 'HEAD') {
  const rel = path.isAbsolute(file) ? path.relative(root, file) : file;
  return git(root, ['show', `${rev}:${rel.split(path.sep).join('/')}`]);
}

async function stage(root, files) { await git(root, ['add', '--', ...files]); return status(root); }
async function unstage(root, files) { await git(root, ['restore', '--staged', '--', ...files]); return status(root); }

/** Commit what is staged (or `files`, staged first). Returns the new commit. */
async function commit(root, message, { files } = {}) {
  const m = String(message || '').trim();
  if (!m) throw Object.assign(new Error('A commit needs a message.'), { status: 400 });
  if (files?.length) await git(root, ['add', '--', ...files]);
  await git(root, ['commit', '-m', m]);
  return (await log(root, { limit: 1 }))[0];
}

async function checkout(root, branch, { create = false } = {}) {
  if (!/^[\w./-]+$/.test(String(branch || '')) || String(branch).startsWith('-')) throw Object.assign(new Error('Not a branch name.'), { status: 400 });
  await git(root, ['switch', ...(create ? ['-c'] : []), branch]);
  return status(root);
}

module.exports = { git, top, status, log, branches, diff, show, stage, unstage, commit, checkout };
