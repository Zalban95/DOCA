'use strict';

/**
 * The host itself: a shell, and reading, writing and listing files.
 */

const fs     = require('fs');
const path   = require('path');
const shell  = require('../../shell');
const repo   = require('../repo');
const { MAX_OUT, SHELL_MS, clip, cwd, resolvePath } = require('./common');

/** How long one shell call may wait: the harness param `shellTimeoutSec` (60 s when unset). */
function shellLimitSec() {
  try {
    const v = Number(require('../agent').params().shellTimeoutSec);
    return v > 0 ? Math.min(v, 3600) : SHELL_MS / 1000;
  } catch { return SHELL_MS / 1000; }
}

module.exports = [
  {
    name: 'shell',
    // The shell is named, and named at call time: a description that says
    // "bash" on a Windows host teaches the model to write `&&` into a
    // PowerShell prompt and then to be puzzled by the error.
    get description() {
      return `Run a command line on the host this panel manages and return its combined output. `
        + `This host runs ${shell.describe()} `
        + 'Use it to inspect the system, run docker/git, and check anything you are unsure about. '
        + `A call waits at most ${shellLimitSec()} s (timeoutSec lowers it). For anything longer — a build, `
        + 'an install, a download — pass background: true: it returns a job id at once and keeps running; '
        + 'follow it with shell_job.';
    },
    get parameters() {
      return {
        type: 'object',
        properties: {
          command: { type: 'string', description: `The command line to run, in ${shell.spec().label} syntax.` },
          cwd:     { type: 'string', description: 'Optional working directory. Defaults to the agent workspace.' },
          timeoutSec: { type: 'integer', description: `Seconds to wait, up to ${shellLimitSec()}.` },
          background: { type: 'boolean', description: 'Run it as a background job and return its id at once.' },
        },
        required: ['command'],
      };
    },
    danger: true,
    run: async ({ command, cwd: dir, timeoutSec, background }, ctx = {}) => {
      if (!command) return 'Error: command is required';
      const where = dir ? resolvePath(dir, ctx) : cwd(ctx);
      if (background) {
        const j = require('../jobs').start(command, { cwd: where, sessionId: ctx.sessionId || null });
        return `Started background job ${j.id} (pid ${j.pid}). It keeps running after this call; `
          + 'shell_job with action status or output tells you how it stands.';
      }
      const limit = shellLimitSec();
      const sec = Math.min(limit, Math.max(1, Number(timeoutSec) || limit));
      const r = await shell.run(command, { cwd: where, timeout: sec * 1000, maxBuffer: 4 << 20 });
      if (r.error) return `Error: ${r.error}.`;
      if (r.timedOut) return `Timed out after ${sec}s and was stopped. For long commands use background: true.\n${clip(r.out)}`;
      return clip([`exit ${r.code}`, r.out || '(no output)'].join('\n'));
    },
  },
  {
    name: 'shell_job',
    description: 'Background jobs started with shell background: true. status: running, exited (with its exit '
      + 'code), stopped, or gone (the panel restarted, so the exit code is not known). output: the end of what it '
      + 'printed. stop: end it and everything it started. list: this conversation\'s jobs.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'output', 'stop', 'list'] },
        id:     { type: 'string', description: 'The job id, for status, output and stop.' },
        bytes:  { type: 'integer', description: 'For output: how much from the end (default 8000).' },
      },
      required: ['action'],
    },
    run: ({ action, id, bytes }, ctx = {}) => {
      const jobs = require('../jobs');
      const line = j => `${j.id} — ${j.state}${j.code != null ? ` (exit ${j.code})` : ''} — started ${j.startedAt}`
        + `${j.endedAt ? `, ended ${j.endedAt}` : ''} — ${j.command.slice(0, 120)}`;
      switch (action) {
        case 'status': return line(jobs.get(id));
        case 'output': { const j = jobs.get(id); return `${line(j)}\n${clip(jobs.output(id, bytes)) || '(no output yet)'}`; }
        case 'stop':   return line(jobs.stop(id));
        case 'list': {
          const rows = jobs.list({ sessionId: ctx.sessionId });
          return rows.length ? rows.map(line).join('\n') : 'No background jobs in this conversation.';
        }
        default: throw new Error('action is one of status, output, stop, list.');
      }
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file from the host.',
    parameters: {
      type: 'object',
      properties: {
        path:      { type: 'string', description: 'Absolute path, or relative to the agent workspace.' },
        maxLength: { type: 'integer', description: 'Characters to read at most (default 8000).' },
      },
      required: ['path'],
    },
    run: ({ path: p, maxLength }, ctx = {}) => {
      const abs = resolvePath(p, ctx);
      const st  = fs.statSync(abs);
      if (st.isDirectory()) throw new Error(`${abs} is a directory — use list_dir`);
      return clip(fs.readFileSync(abs, 'utf8'), Math.min(Number(maxLength) || MAX_OUT, 40000));
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a text file on the host. Read the file first when you mean to edit it.',
    parameters: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'Absolute path, or relative to the agent workspace.' },
        content: { type: 'string', description: 'The complete new contents of the file.' },
      },
      required: ['path', 'content'],
    },
    danger: true,
    run: ({ path: p, content }, ctx = {}) => {
      const abs = resolvePath(p, ctx);
      require('../control-plane').refuse(abs, ctx);   // what governs the agent: only with this call's yes (H-19)
      // Charter rule 16, held here rather than only asked for: a repository's
      // own rules are read before the first change to it.
      const unread = repo.unreadRoot(ctx.sessionId, abs);
      if (unread) throw new Error(`${unread} is a git repository with its own rules, and this conversation has not read them. `
        + `Call repo_rules with path "${abs}" first, then write again.`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      let backup = null;
      if (fs.existsSync(abs)) {
        backup = repo.backupPath(abs);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(abs, backup);
      }
      fs.writeFileSync(abs, String(content ?? ''), 'utf8');
      return `Wrote ${Buffer.byteLength(String(content ?? ''))} bytes to ${abs}`
        + (backup ? ` (previous version kept at ${backup})` : '');
    },
  },
  {
    name: 'list_dir',
    description: 'List the entries of a directory with their type and size.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path, or relative to the agent workspace.' } },
      required: ['path'],
    },
    run: ({ path: p }, ctx = {}) => {
      const abs  = resolvePath(p, ctx);
      const rows = fs.readdirSync(abs, { withFileTypes: true }).map(d => {
        let size = '';
        try { if (d.isFile()) size = ` ${fs.statSync(path.join(abs, d.name)).size}b`; } catch {}
        return `${d.isDirectory() ? 'dir ' : 'file'} ${d.name}${size}`;
      });
      return clip(`${abs} (${rows.length} entries)\n${rows.join('\n')}`);
    },
  },
];
