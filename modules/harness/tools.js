'use strict';

/**
 * The tools the built-in harness can call.
 *
 * Each entry is an OpenAI-style function declaration plus a `run` that returns
 * a string for the model. Output is always bounded — one `find /` would
 * otherwise blow the context window on a single call.
 *
 * Reach is deliberately the same as the rest of the panel already gives a
 * browser session (a shell, the file manager's roots, system status), and every
 * tool can be switched off individually in the harness ⚙ panel.
 */
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { exec } = require('child_process');

const { WORKSPACE_DIR, FM_ALLOWED_ROOTS } = require('../paths');
const { fmSafe } = require('../utils');
const memory = require('./memory');

const MAX_OUT   = 8000;   // characters of tool output handed back to the model
const SHELL_MS  = 60000;

function clip(text, limit = MAX_OUT) {
  const s = String(text ?? '');
  return s.length <= limit
    ? s
    : `${s.slice(0, limit)}\n… [truncated, ${s.length - limit} more characters]`;
}

/** Working directory for shell + relative paths: the agent's workspace. */
function cwd() {
  return fs.existsSync(WORKSPACE_DIR) ? WORKSPACE_DIR : os.homedir();
}

function resolvePath(p) {
  const expanded = String(p || '').replace(/^~(?=$|[/\\])/, os.homedir());
  const abs = path.resolve(cwd(), expanded);
  if (!fmSafe(abs))
    throw new Error(`Path is outside the allowed roots (${FM_ALLOWED_ROOTS.join(', ')}): ${abs}`);
  return abs;
}

const TOOLS = [
  {
    name: 'shell',
    description: 'Run a bash command on the host this panel manages and return its combined output. '
      + 'Use it to inspect the system, run docker/git/systemctl, and check anything you are unsure about.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command line to run.' },
        cwd:     { type: 'string', description: 'Optional working directory. Defaults to the agent workspace.' },
      },
      required: ['command'],
    },
    danger: true,
    run: ({ command, cwd: dir }) => new Promise(resolve => {
      if (!command) return resolve('Error: command is required');
      exec(command, { cwd: dir ? resolvePath(dir) : cwd(), timeout: SHELL_MS, maxBuffer: 4 << 20, shell: '/bin/bash' },
        (err, stdout, stderr) => {
          const body = [stdout, stderr].filter(s => s && s.trim()).join('\n').trim();
          if (err && err.killed) return resolve(`Timed out after ${SHELL_MS / 1000}s.\n${clip(body)}`);
          resolve(clip([err ? `exit ${err.code ?? 1}` : 'exit 0', body || '(no output)'].join('\n')));
        });
    }),
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
  {
    name: 'memory_write',
    description: 'Remember something for good. Use it for facts about this machine, paths, ports, hardware, '
      + 'and the user\'s standing preferences — anything you would want to know at the start of a future '
      + 'conversation. Writing an existing key overwrites it. Never store secrets.',
    parameters: {
      type: 'object',
      properties: {
        key:    { type: 'string', description: 'Short stable identifier, e.g. "gpu" or "models-dir".' },
        value:  { type: 'string', description: 'The fact itself, in one or two sentences.' },
        tags:   { type: 'array', items: { type: 'string' }, description: 'Optional keywords to help you find it later.' },
        pinned: { type: 'boolean', description: 'Pin to always include it in your context.' },
      },
      required: ['key', 'value'],
    },
    run: ({ key, value, tags, pinned }) => {
      const e = memory.memWrite({ key, value, tags, pinned, source: 'agent' });
      return `Remembered "${e.key}"${e.pinned ? ' (pinned)' : ''}.`;
    },
  },
  {
    name: 'memory_search',
    description: 'Search your durable memory by keyword. Do this before answering a question that depends on '
      + 'something you were told in an earlier conversation.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to look for.' },
        limit: { type: 'integer', description: 'Maximum entries to return (default 8).' },
      },
      required: ['query'],
    },
    run: ({ query, limit }) => {
      const hits = memory.memSearch(query, Math.min(Number(limit) || 8, 30));
      memory.memTouch(hits);
      if (!hits.length) return `Nothing in memory matches "${query}".`;
      return clip(hits.map(e => `- ${e.key}: ${e.value}`).join('\n'));
    },
  },
  {
    name: 'memory_forget',
    description: 'Delete a memory entry by key once it is wrong or obsolete.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string', description: 'The key to forget.' } },
      required: ['key'],
    },
    run: ({ key }) => { memory.memForget(key); return `Forgot "${key}".`; },
  },
  {
    name: 'system_status',
    description: 'Current state of the machine: CPU, RAM, GPU, disks, running containers and local models.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const s = await require('../controls').collectStatus();
      return clip(JSON.stringify(s, null, 1), 6000);
    },
  },
  {
    name: 'http_fetch',
    description: 'Fetch a URL and return the response body as text. Use it for docs, APIs and health checks.',
    parameters: {
      type: 'object',
      properties: {
        url:    { type: 'string', description: 'The absolute URL to fetch.' },
        method: { type: 'string', description: 'HTTP method (default GET).' },
        body:   { type: 'string', description: 'Optional request body.' },
      },
      required: ['url'],
    },
    run: async ({ url, method, body }) => {
      const r = await fetch(url, {
        method:  (method || 'GET').toUpperCase(),
        body:    body || undefined,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        signal:  AbortSignal.timeout(20000),
      });
      return clip(`HTTP ${r.status} ${r.statusText}\n\n${await r.text()}`);
    },
  },
];

/** Metadata for the ⚙ panel's per-tool switches. */
function describe() {
  return TOOLS.map(t => ({ name: t.name, description: t.description.split('.')[0], danger: !!t.danger }));
}

/** The tool declarations to send to the model, minus anything switched off. */
function schemas(disabled = []) {
  return TOOLS
    .filter(t => !disabled.includes(t.name))
    .map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

/**
 * Run one tool call. Errors come back as text rather than throwing: a model
 * that gets "no such file" can correct itself, whereas a dead turn cannot.
 * @returns {Promise<string>}
 */
async function call(name, args, disabled = []) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool)                  return `Error: no tool named "${name}".`;
  if (disabled.includes(name)) return `Error: the "${name}" tool is switched off for this harness.`;
  try {
    return String(await tool.run(args || {}));
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

module.exports = { TOOLS, describe, schemas, call, clip };
