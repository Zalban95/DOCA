'use strict';

/**
 * Working on code: search and replace across files, git, and a project's own
 * commands. The Projects tab calls the same modules (modules/projects), so
 * what the owner sees there and what the agent does here cannot drift apart.
 *
 * Every tool works where the conversation works — the project root when it is
 * bound to a project (toolbox/common.cwd) — and takes `path` to work elsewhere.
 */
const { clip, cwd, resolvePath } = require('./common');

const where = (p, ctx) => (p ? resolvePath(p, ctx) : cwd(ctx));

async function repoRoot(p, ctx) {
  const git = require('../../projects/git');
  const root = await git.top(where(p, ctx));
  if (!root) throw new Error(`${where(p, ctx)} is not inside a git repository.`);
  return root;
}

const fmtMatches = r => [
  `${r.matches.length}${r.truncated ? '+' : ''} match(es) in ${r.files} file(s)${r.truncated ? ' (stopped at the limit — narrow the search)' : ''}:`,
  ...r.matches.slice(0, 400).map(m => `${m.file}:${m.line}:${m.col}: ${m.text.trim()}`),
].join('\n');

module.exports = [
  {
    name: 'search_files',
    description: 'Search the text of every file under a folder (the project root by default): plain text or a regular '
      + 'expression, match case, whole word, include/exclude globs. Skips .git, node_modules, build output and binary '
      + 'files. Returns file:line:column: line. Use it instead of grep through shell.',
    parameters: {
      type: 'object',
      properties: {
        query:         { type: 'string' },
        path:          { type: 'string', description: 'Folder to search. Default: the project root, or the workspace.' },
        regex:         { type: 'boolean' },
        caseSensitive: { type: 'boolean' },
        wholeWord:     { type: 'boolean' },
        include:       { type: 'string', description: 'Globs to search only, comma-separated: "*.kt, src/**".' },
        exclude:       { type: 'string', description: 'Globs to leave out, comma-separated.' },
      },
      required: ['query'],
    },
    run: async (a, ctx = {}) => clip(fmtMatches(await require('../../projects/search').search(where(a.path, ctx), a))),
  },
  {
    name: 'replace_in_files',
    description: 'Replace text across every file under a folder, with the same options as search_files ($1 works in '
      + 'regex mode). It is a dry run unless apply is true: look at the changes it lists first, then call again with '
      + 'apply: true (and `only` to limit it to some of those files).',
    parameters: {
      type: 'object',
      properties: {
        query:         { type: 'string' },
        replacement:   { type: 'string' },
        path:          { type: 'string' },
        regex:         { type: 'boolean' },
        caseSensitive: { type: 'boolean' },
        wholeWord:     { type: 'boolean' },
        include:       { type: 'string' },
        exclude:       { type: 'string' },
        only:          { type: 'array', items: { type: 'string' }, description: 'Relative paths to change, from the dry run.' },
        apply:         { type: 'boolean', description: 'Write the changes. Default false: show them.' },
      },
      required: ['query', 'replacement'],
    },
    danger: true,
    run: (a, ctx = {}) => {
      const r = require('../../projects/search').replaceInFiles(where(a.path, ctx),
        { ...a, dryRun: !a.apply, refuse: abs => require('../control-plane').which(abs) });
      const head = `${r.written ? 'Replaced' : 'Would replace'} ${r.replacements} occurrence(s) in ${r.files} file(s)`
        + (r.written ? '.' : '. Nothing is written yet: call again with apply: true.');
      return clip([head, ...r.changes.flatMap(c => [`${c.file} (${c.replacements})`,
        ...c.lines.slice(0, 10).map(l => `  ${l.line}: - ${l.before.trim()}\n  ${l.line}: + ${l.after.trim()}`)])].join('\n'));
    },
  },
  {
    name: 'git',
    description: 'Git in the project (or the repository `path` is in): status, log (optionally for one file), diff '
      + '(working tree, staged, against a revision, or one commit), show (a file as it was at a revision), branches, '
      + 'stage, unstage, commit, switch (a branch; create: true for a new one). It never pushes, resets or '
      + 'discards work — that stays with the owner.',
    parameters: {
      type: 'object',
      properties: {
        action:  { type: 'string', enum: ['status', 'log', 'diff', 'show', 'branches', 'stage', 'unstage', 'commit', 'switch'] },
        path:    { type: 'string', description: 'A folder in the repository. Default: the project root.' },
        file:    { type: 'string', description: 'For log, diff, show: one file (relative to the repository).' },
        files:   { type: 'array', items: { type: 'string' }, description: 'For stage, unstage, commit.' },
        rev:     { type: 'string', description: 'For diff/show/log: a revision (HEAD~1, a hash, a branch).' },
        commit:  { type: 'string', description: 'For diff: one commit\'s changes.' },
        staged:  { type: 'boolean' },
        message: { type: 'string', description: 'For commit.' },
        branch:  { type: 'string', description: 'For switch.' },
        create:  { type: 'boolean' },
        limit:   { type: 'integer' },
      },
      required: ['action'],
    },
    danger: true,
    run: async (a, ctx = {}) => {
      const git = require('../../projects/git');
      const root = await repoRoot(a.path, ctx);
      const st = s => [`On ${s.branch}${s.upstream ? ` (tracking ${s.upstream}${s.ahead ? `, ${s.ahead} ahead` : ''}${s.behind ? `, ${s.behind} behind` : ''})` : ''}; ${s.files.length} changed file(s)`,
        ...s.files.map(f => `${f.staged || ' '}${f.unstaged || ' '} ${f.path}${f.from ? ` (from ${f.from})` : ''}`)].join('\n');
      switch (a.action) {
        case 'status':   return st(await git.status(root));
        case 'log':      return (await git.log(root, { file: a.file, limit: a.limit || 30, rev: a.rev })).map(c => `${c.short} ${c.date.slice(0, 10)} ${c.author}: ${c.subject}${c.refs.length ? ` [${c.refs.join(', ')}]` : ''}`).join('\n') || 'No commits.';
        case 'diff':     return clip(await git.diff(root, { file: a.file, rev: a.rev, staged: a.staged, commit: a.commit }) || 'No differences.');
        case 'show':     if (!a.file) throw new Error('show needs a file.'); return clip(await git.show(root, a.file, a.rev || 'HEAD'));
        case 'branches': return (await git.branches(root)).map(b => `${b.current ? '*' : ' '} ${b.name} ${b.hash}`).join('\n');
        case 'stage':    return st(await git.stage(root, a.files || []));
        case 'unstage':  return st(await git.unstage(root, a.files || []));
        case 'commit':   { const c = await git.commit(root, a.message, { files: a.files }); return `Committed ${c.short}: ${c.subject}`; }
        case 'switch':   return st(await git.checkout(root, a.branch, { create: !!a.create }));
        default: throw new Error('Unknown git action.');
      }
    },
  },
  {
    name: 'project',
    description: 'Projects: a folder with its kind, its build/test commands, and what is installed. info: the project '
      + 'this conversation works in (or `id`). list: all projects. open: make a folder a project (root). bind: make '
      + 'this conversation work in a project. run: run one of its commands by name (build, test, lint, install…), in '
      + 'the project root; it waits up to waitSec (default 60) and otherwise returns a background job to follow '
      + 'with shell_job. Checkpoints undo a run: one is taken before each of your turns in a project (when '
      + 'files changed); checkpoint takes one now, checkpoints lists them, changes shows what differs since '
      + 'one, restore puts the project back as it was then (after taking a checkpoint of now, so a restore '
      + 'is undoable) — then try again another way.',
    parameters: {
      type: 'object',
      properties: {
        action:  { type: 'string', enum: ['info', 'list', 'open', 'bind', 'run', 'checkpoint', 'checkpoints', 'changes', 'restore'] },
        checkpoint: { type: 'string', description: 'For changes and restore: a checkpoint id (cp_…).' },
        label:   { type: 'string', description: 'For checkpoint: what this moment is.' },
        id:      { type: 'string', description: 'A project id; default: this conversation\'s project.' },
        root:    { type: 'string', description: 'For open: the folder.' },
        name:    { type: 'string', description: 'For open: a name.' },
        command: { type: 'string', description: 'For run: the command\'s name.' },
        waitSec: { type: 'integer', description: 'For run: how long to wait for it. Default 60.' },
      },
      required: ['action'],
    },
    danger: true,
    run: async (a, ctx = {}) => {
      const projects = require('../../projects/store');
      const pick = () => {
        const p = a.id ? projects.need(a.id) : projects.forSession(ctx.sessionId);
        if (!p) throw new Error('This conversation is not in a project: give an id, or bind it first.');
        return p;
      };
      switch (a.action) {
        case 'list': return projects.list().map(p => `${p.id} — ${p.name} — ${p.root}`).join('\n') || 'No projects yet.';
        case 'open': { const p = projects.create({ root: resolvePath(a.root, ctx), name: a.name }); return `Project ${p.id}: ${p.name} at ${p.root}.`; }
        case 'bind': {
          if (!ctx.sessionId) throw new Error('No conversation to bind.');
          const p = projects.bind(pick().id, ctx.sessionId);
          require('../../projects/brief').forget(p.id);
          return `This conversation now works in ${p.name} (${p.root}).`;
        }
        case 'info': {
          const p = pick();
          require('../../projects/brief').forget(p.id);
          return require('../../projects/brief').text(p);
        }
        case 'run': {
          const r = await require('../../projects/run').run(pick().id, a.command, { waitSec: a.waitSec ?? 60, sessionId: ctx.sessionId || null });
          if (r.job.state === 'running') return `${r.command.run} is still running as background job ${r.job.id}; follow it with shell_job.`;
          return clip(`${r.command.run} — ${r.job.state}${r.job.code != null ? ` (exit ${r.job.code})` : ''}\n${r.output || '(no output)'}`);
        }
        case 'checkpoint': {
          const c = await require('../../projects/checkpoints').take(pick(), { label: a.label || 'checkpoint by the agent', sessionId: ctx.sessionId || null, by: 'agent' });
          return c.unchanged ? `Nothing changed since ${c.id} (${c.label}); no new checkpoint.` : `Checkpoint ${c.id}: ${c.label}.`;
        }
        case 'checkpoints': {
          const list = require('../../projects/checkpoints').list(pick()).slice(0, 20);
          return list.length ? list.map(c => `${c.id} ${c.at} ${c.by}: ${c.label}${c.changedSincePrevious != null ? ` (${c.changedSincePrevious} files since the one before)` : ''}`).join('\n') : 'No checkpoints yet.';
        }
        case 'changes': {
          const ch = await require('../../projects/checkpoints').changes(pick(), a.checkpoint);
          return ch.length ? `${ch.length} file(s) differ since ${a.checkpoint}:\n${ch.map(c => `${c.status} ${c.path}`).join('\n')}` : `Nothing differs since ${a.checkpoint}.`;
        }
        case 'restore': {
          const r = await require('../../projects/checkpoints').restore(pick(), a.checkpoint, { sessionId: ctx.sessionId || null, by: 'agent' });
          return `Restored ${r.restored.id} (${r.restored.label}): ${r.reverted} file(s) put back, ${r.removed} made since removed.`
            + (r.undo ? ` To undo this restore: restore ${r.undo}.` : '');
        }
        default: throw new Error('Unknown project action.');
      }
    },
  },
];
