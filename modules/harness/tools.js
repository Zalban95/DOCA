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
const memory   = require('./memory');
const settings = require('./settings');
const mcp      = require('../mcp/tools');

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
    description: 'Remember something for good, following the memory rules in your context. Use it for facts '
      + 'about this machine, paths, ports, hardware, and the user\'s standing preferences — anything you would '
      + 'want to know at the start of a future conversation. Writing an existing key overwrites it. Never store secrets.',
    parameters: {
      type: 'object',
      properties: {
        key:      { type: 'string', description: 'Short stable identifier, e.g. "gpu" or "models-dir".' },
        value:    { type: 'string', description: 'The fact itself, in one or two sentences.' },
        category: { type: 'string', description: 'One of your memory categories, listed in your context.' },
        tags:     { type: 'array', items: { type: 'string' }, description: 'Optional keywords to help you find it later.' },
        pinned:   { type: 'boolean', description: 'Pin to always include it in your context.' },
      },
      required: ['key', 'value'],
    },
    run: ({ key, value, tags, pinned, category }) => {
      const e = memory.memWrite({ key, value, tags, pinned, category, source: 'agent' });
      return `Remembered "${e.key}"${e.category ? ` under ${e.category}` : ''}${e.pinned ? ', pinned' : ''}.`;
    },
  },
  {
    name: 'memory_rules_write',
    description: 'Change how you keep your own memory: the categories facts are filed under and the rules you '
      + 'follow when writing them. Both are in your context every turn. Use it when you find a better way to '
      + 'keep this memory, or when the user tells you one. Pass only the list you are changing.',
    parameters: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          description: 'The complete new category list, replacing the old one.',
          items: {
            type: 'object',
            properties: {
              id:          { type: 'string', description: 'Short lower-case name, e.g. "machine".' },
              description: { type: 'string', description: 'What belongs in it.' },
            },
            required: ['id'],
          },
        },
        rules: {
          type: 'array',
          items: { type: 'string' },
          description: 'The complete new rule list, replacing the old one. Include the rules you are keeping.',
        },
      },
    },
    run: ({ categories, rules }) => {
      if (categories === undefined && rules === undefined)
        return 'Error: pass categories, rules, or both.';
      const doc = memory.rulesWrite({ categories, rules, source: 'agent' });
      return `Memory rules updated: ${doc.categories.length} categories, ${doc.rules.length} rules.`;
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
    name: 'settings_read',
    description: 'Read this panel\'s settings — every one you are allowed to suggest a change to, with its '
      + 'current value. Do this before proposing anything, so you change what is actually set rather than what '
      + 'you assumed.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional substring to match against the setting paths, e.g. "paths" or "harness".' },
      },
    },
    run: ({ filter }) => {
      const q    = String(filter || '').toLowerCase();
      const rows = settings.readable().filter(r => !q || r.path.toLowerCase().includes(q));
      if (!rows.length) return `No settings match "${filter}".`;
      const body = rows.map(r =>
        `${r.path} = ${JSON.stringify(r.value)}${r.detail ? `   # ${r.detail}` : ''}`).join('\n');
      return clip(`${rows.length} settings you may propose changes to:\n${body}`);
    },
  },
  {
    name: 'settings_propose',
    description: 'Suggest a settings change. This does NOT apply it: the user sees the old and new values and '
      + 'accepts or declines. Put every key of one coherent change in a single call, give a one-line reason, '
      + 'then stop and let them answer — do not poll, repeat, or apply it another way.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why, in one line, in the user\'s terms.' },
        changes: {
          type: 'array',
          description: 'The keys to change, as dotted settings paths from settings_read.',
          items: {
            type: 'object',
            properties: {
              path:  { type: 'string', description: 'Dotted settings path, e.g. "paths.WORKSPACE_DIR".' },
              value: { description: 'The value to set. Same type as the current one.' },
            },
            required: ['path', 'value'],
          },
        },
      },
      required: ['reason', 'changes'],
    },
    run: ({ reason, changes }) => {
      const p = settings.propose({ changes, reason });
      const lines = p.changes.map(c => `  ${c.path}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
      return `Proposed (${p.id}) — waiting for the user to accept or decline:\n${lines.join('\n')}\n`
        + 'Tell them what you proposed and why, then stop.';
    },
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
    name: 'doca_clients',
    description: 'The devices paired with this hub and which of them are reachable right now: form factor, online state, queued events, last seen, and what each is allowed to do. Use it before deciding where to reach the user — asking a watch that is offline gets queued, asking one that cannot chat gets nothing.',
    parameters: { type: 'object', properties: {} },
    run: () => {
      // Required here rather than at the top: this is the harness reaching into
      // the client layer, and the client layer's own adapter reaches back here.
      const devices = require('../api-v1/devices');
      const bus     = require('../api-v1/bus');
      const { hasScope } = require('../api-v1/scopes');

      const live = devices.list().filter(d => !d.revokedAt);
      if (!live.length) return 'No devices are paired with this hub yet. Pairing happens in the dashboard (Devices), not from here.';

      const rows = live.map(d => {
        const can = [
          hasScope(d.scopes, 'harness:chat') && 'chat',
          hasScope(d.scopes, 'interact')     && 'prompts',
          hasScope(d.scopes, 'command:*')    && 'commands',
          hasScope(d.scopes, 'sensors:report') && 'sensors',
        ].filter(Boolean).join(',') || 'read-only';
        const pending = bus.pendingCount(d.id);
        return [
          d.id,
          d.name,
          d.kind === 'agent' ? 'agent' : (d.caps?.formFactor || 'device'),
          bus.isOnline(d.id) ? 'ONLINE' : 'offline',
          `queued=${pending}`,
          `lastSeen=${d.lastSeenAt || 'never'}`,
          `can=${can}`,
        ].join('  ');
      });

      // The counts first: a model that only reads the first line still answers
      // "who is connected" correctly.
      const online = live.filter(d => bus.isOnline(d.id)).length;
      return `${live.length} paired, ${online} connected right now.\n${rows.join('\n')}\n`
        + 'These are the hub\'s own paired clients. Sockets and tailnet peers are a different question — use system_status or shell for those.';
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

/** Metadata for the ⚙ panel's per-tool switches, built-in ones then MCP's. */
function describe() {
  return [
    ...TOOLS.map(t => ({ name: t.name, description: t.description.split('.')[0], danger: !!t.danger })),
    ...mcp.describe(),
  ];
}

/** The tool declarations to send to the model, minus anything switched off. */
function schemas(disabled = []) {
  return [
    ...TOOLS
      .filter(t => !disabled.includes(t.name))
      .map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
    ...mcp.schemas(disabled),
  ];
}

/**
 * Run one tool call. Errors come back as text rather than throwing: a model
 * that gets "no such file" can correct itself, whereas a dead turn cannot.
 * @returns {Promise<string>}
 */
async function call(name, args, disabled = []) {
  if (disabled.includes(name)) return `Error: the "${name}" tool is switched off for this harness.`;
  if (mcp.isMcpTool(name))     return mcp.call(name, args);

  const tool = TOOLS.find(t => t.name === name);
  if (!tool) return `Error: no tool named "${name}".`;
  try {
    return String(await tool.run(args || {}));
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

module.exports = { TOOLS, describe, schemas, call, clip };
