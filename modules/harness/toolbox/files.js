'use strict';

/**
 * The host itself: a shell, and reading, writing and listing files.
 */

const fs     = require('fs');
const path   = require('path');
const shell  = require('../../shell');
const { MAX_OUT, SHELL_MS, clip, cwd, resolvePath } = require('./common');

module.exports = [
  {
    name: 'shell',
    // The shell is named, and named at call time: a description that says
    // "bash" on a Windows host teaches the model to write `&&` into a
    // PowerShell prompt and then to be puzzled by the error.
    get description() {
      return `Run a command line on the host this panel manages and return its combined output. `
        + `This host runs ${shell.describe()} `
        + 'Use it to inspect the system, run docker/git, and check anything you are unsure about.';
    },
    get parameters() {
      return {
        type: 'object',
        properties: {
          command: { type: 'string', description: `The command line to run, in ${shell.spec().label} syntax.` },
          cwd:     { type: 'string', description: 'Optional working directory. Defaults to the agent workspace.' },
        },
        required: ['command'],
      };
    },
    danger: true,
    run: async ({ command, cwd: dir }) => {
      if (!command) return 'Error: command is required';
      const r = await shell.run(command, {
        cwd: dir ? resolvePath(dir) : cwd(), timeout: SHELL_MS, maxBuffer: 4 << 20,
      });
      if (r.error) return `Error: ${r.error}.`;
      if (r.timedOut) return `Timed out after ${SHELL_MS / 1000}s.\n${clip(r.out)}`;
      return clip([`exit ${r.code}`, r.out || '(no output)'].join('\n'));
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
    run: ({ path: p, maxLength }) => {
      const abs = resolvePath(p);
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
    run: ({ path: p, content }) => {
      const abs = resolvePath(p);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (fs.existsSync(abs)) fs.copyFileSync(abs, abs + '.bak');
      fs.writeFileSync(abs, String(content ?? ''), 'utf8');
      return `Wrote ${Buffer.byteLength(String(content ?? ''))} bytes to ${abs}`;
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
    run: ({ path: p }) => {
      const abs  = resolvePath(p);
      const rows = fs.readdirSync(abs, { withFileTypes: true }).map(d => {
        let size = '';
        try { if (d.isFile()) size = ` ${fs.statSync(path.join(abs, d.name)).size}b`; } catch {}
        return `${d.isDirectory() ? 'dir ' : 'file'} ${d.name}${size}`;
      });
      return clip(`${abs} (${rows.length} entries)\n${rows.join('\n')}`);
    },
  },
];
