'use strict';

/**
 * MCP tools, as the built-in harness sees them.
 *
 * Only servers that are actually running contribute: a tool declared to the
 * model has to be callable, and a stopped server's tools are not. The names are
 * prefixed with the server they came from — `mcp__github__create_issue` — so two
 * servers offering `search` do not collide, and so the ⚙ panel's per-tool
 * switches (which key on the tool name) work on them like any other tool.
 */
const registry = require('./registry');

const PREFIX = 'mcp';
const SEP    = '__';
const MAX_NAME = 64;   // the limit OpenAI-compatible APIs put on a function name

function safe(part) {
  return String(part || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Every tool of every running server, with the exposed name resolved back to
 * the server and tool it came from.
 * @returns {{ exposed: string, server: string, tool: string, description: string,
 *            schema: object, readOnly: boolean }[]}
 */
function available() {
  const out  = [];
  const seen = new Set();

  for (const spec of registry.load()) {
    const c = registry.client(spec.id);
    if (c?.state !== 'running') continue;

    for (const t of c.tools) {
      let exposed = `${PREFIX}${SEP}${safe(spec.id)}${SEP}${safe(t.name)}`.slice(0, MAX_NAME);
      // Truncation (or two servers with lookalike ids) can collide; keep every
      // tool reachable rather than letting one shadow another.
      if (seen.has(exposed)) {
        let n = 2;
        while (seen.has(`${exposed.slice(0, MAX_NAME - 2)}_${n}`)) n++;
        exposed = `${exposed.slice(0, MAX_NAME - 2)}_${n}`;
      }
      seen.add(exposed);
      out.push({
        exposed,
        server:      spec.id,
        serverLabel: spec.label || spec.id,
        origin:      spec.origin?.kind === 'client' ? 'client' : 'server',
        tool:        t.name,
        description: t.description,
        schema:      t.inputSchema,
        readOnly:    t.readOnly,
      });
    }
  }
  return out;
}

/** Metadata for the ⚙ panel's per-tool switches. */
function describe() {
  return available().map(t => ({
    name:        t.exposed,
    label:       `${t.serverLabel}: ${t.tool}`,
    description: (t.description || `${t.tool} from ${t.serverLabel}`).split('\n')[0],
    danger:      !t.readOnly,
    mcp:         true,
    // Which machine the call lands on. A tool that reaches somebody's desktop
    // is worth telling apart from one that runs beside the panel.
    origin:      t.origin,
  }));
}

/** Tool declarations for the model, minus anything switched off. */
function schemas(disabled = []) {
  return available()
    .filter(t => !disabled.includes(t.exposed))
    .map(t => ({
      type: 'function',
      function: {
        name:        t.exposed,
        description: t.description || `${t.tool} (via the ${t.serverLabel} MCP server)`,
        // A server may omit `type`, which some providers reject outright.
        parameters:  { type: 'object', properties: {}, ...t.schema },
      },
    }));
}

function isMcpTool(name) {
  return String(name || '').startsWith(`${PREFIX}${SEP}`);
}

/**
 * Run one MCP tool call. Like the built-in tools, failures come back as text so
 * the model can react to them instead of the turn dying.
 */
async function call(name, args) {
  const t = available().find(x => x.exposed === name);
  if (!t) return `Error: no MCP tool named "${name}" — its server may have stopped.`;
  const c = registry.client(t.server);
  if (c?.state !== 'running') return `Error: the "${t.serverLabel}" MCP server is not running.`;
  try {
    return await c.callTool(t.tool, args || {});
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

module.exports = { available, describe, schemas, call, isMcpTool };
