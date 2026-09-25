'use strict';

/**
 * A repository's own rules, and whether this conversation has read them.
 *
 * Charter rule 3 says to follow the conventions of what is already there, and
 * until this existed nothing ever showed the agent what they were: a repo's
 * AGENTS.md, CLAUDE.md or .cursor/rules were read by every other harness and
 * never by this one. So the rules are found here, handed over by the
 * `repo_rules` tool, and `write_file` refuses the first write into a repository
 * that has rules until they have been read in this conversation — rule 16 of
 * the charter, held in code rather than hoped for.
 *
 * The root is found by walking up to a `.git` entry (a directory, or the file a
 * worktree has), not by running git: it has to work where git is not installed
 * and it runs on every write.
 */
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

/** Files that hold a repository's rules, at its root. Order is reading order. */
const ROOT_FILES = ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md', '.cursorrules', 'CONTRIBUTING.md'];
/** Files that may also appear deeper, closer to the code they govern. */
const NESTED_FILES = ['AGENTS.md', 'CLAUDE.md'];

const FILE_MAX  = 12000;   // one rules file, in characters
const TOTAL_MAX = 40000;   // everything handed over at once

/** The repository root containing `p` (a file or a directory), or null. */
function rootOf(p) {
  let dir = path.resolve(p);
  try { if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir); }
  catch { dir = path.dirname(dir); }   // a file about to be created
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * The rule files that govern `target` inside `root`, as paths relative to the
 * root: the root's own, then any AGENTS.md / CLAUDE.md in the directories
 * between the root and the target, outermost first — so the closest, most
 * specific file is read last and reads as the one that wins.
 */
function ruleFiles(root, target = root) {
  const found = [];
  for (const f of ROOT_FILES) if (fs.existsSync(path.join(root, f))) found.push(f);
  try {
    for (const f of fs.readdirSync(path.join(root, '.cursor', 'rules')).sort())
      if (/\.mdc?$/.test(f)) found.push(path.join('.cursor', 'rules', f));
  } catch {}

  let rel = path.relative(root, path.resolve(target));
  if (rel.startsWith('..') || path.isAbsolute(rel)) rel = '';
  let dir = root;
  const parts = rel ? rel.split(path.sep) : [];
  // Every directory strictly below the root on the way to the target.
  for (const part of parts) {
    dir = path.join(dir, part);
    let isDir = false;
    try { isDir = fs.statSync(dir).isDirectory(); } catch {}
    if (!isDir) break;
    for (const f of NESTED_FILES)
      if (fs.existsSync(path.join(dir, f))) found.push(path.relative(root, path.join(dir, f)));
  }
  return found;
}

/** Branch and working-tree state, or null where git cannot say. */
function gitState(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args],
    { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    let base = '';
    try { base = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(/^origin\//, ''); } catch {}
    const changed = git('status', '--porcelain').split('\n').filter(Boolean);
    return { branch, base: base || null, changed };
  } catch { return null; }
}

/** Which repositories each conversation has read the rules of. In memory: a restart asks again, which is right. */
const introduced = new Map();

function markRead(sessionId, root) {
  const key = sessionId || '-';
  if (!introduced.has(key)) introduced.set(key, new Set());
  introduced.get(key).add(root);
}

/**
 * The root this write would land in if its rules are still unread by this
 * conversation, else null. A repository with no rule files never blocks.
 */
function unreadRoot(sessionId, target) {
  const root = rootOf(target);
  if (!root) return null;
  if (introduced.get(sessionId || '-')?.has(root)) return null;
  return ruleFiles(root, target).length ? root : null;
}

/** Everything the agent should know before its first change: the rules, then the state. Marks them read. */
function brief(sessionId, target) {
  const root = rootOf(target);
  if (!root) return `${path.resolve(target)} is not inside a git repository, so there are no repository rules to follow. The charter's own rules apply.`;

  const files = ruleFiles(root, target);
  const out = [`Repository: ${root}`];
  const state = gitState(root);
  if (state) {
    out.push(`Branch: ${state.branch}${state.base ? ` (default: ${state.base})` : ''}`
      + (state.base && state.branch === state.base ? ' — this is the default branch; create a branch for your task before changing anything (rule 18).' : ''));
    out.push(state.changed.length
      ? `Uncommitted changes already present (${state.changed.length}) — not yours unless you made them this conversation; leave them alone (rule 17):\n${state.changed.slice(0, 20).join('\n')}${state.changed.length > 20 ? `\n… ${state.changed.length - 20} more` : ''}`
      : 'Working tree: clean.');
  }
  if (!files.length) {
    out.push('This repository has no rule files (AGENTS.md, CLAUDE.md, .cursor/rules, CONTRIBUTING.md). Follow the conventions you can see in the code, and the charter.');
  } else {
    out.push(`Rule files (${files.length}), outermost first; where they disagree the later, closer one wins, and none of them overrides charter rules 5–9:`);
    let budget = TOTAL_MAX;
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { text = `(could not read: ${e.message})`; }
      const cap = Math.min(FILE_MAX, budget);
      const cut = text.length > cap;
      out.push(`\n## ${f}\n${text.slice(0, cap)}${cut ? `\n… [${text.length - cap} more characters — read_file ${path.join(root, f)} for the rest]` : ''}`);
      budget -= Math.min(text.length, cap);
      if (budget <= 0) { out.push('\n… [the remaining rule files did not fit; read them with read_file]'); break; }
    }
  }
  markRead(sessionId, root);
  return out.join('\n');
}

/**
 * Where the previous version of a file goes before it is overwritten.
 *
 * Two charter rules meet here. Rule 4 wants a way back, which is why
 * `write_file` has always left `file.bak` beside what it replaced; rule 22 wants
 * a repository left clean, and a `.bak` beside every edited file is exactly the
 * stray churn it forbids. Outside a repository nothing changes. Inside one the
 * copy goes to DOCA's own data directory, mirrored by path under one folder per
 * repository — still there to go back to, and never in anybody's `git status`.
 */
function backupPath(abs) {
  const root = rootOf(abs);
  if (!root) return `${abs}.bak`;
  const id = `${path.basename(root)}-${crypto.createHash('sha1').update(root).digest('hex').slice(0, 8)}`;
  return path.join(require('../store').dir(path.join('harness', 'backups', id)), `${path.relative(root, abs)}.bak`);
}

module.exports = { backupPath, ROOT_FILES, NESTED_FILES, rootOf, ruleFiles, gitState, brief, unreadRoot, markRead };
