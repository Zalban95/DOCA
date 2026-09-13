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

    // Once per server, not once per tool: this runs on every step of every turn.
    const onClient   = spec.origin?.kind === 'client';
    const originName = onClient
      ? (registry.originDevice(spec.origin)?.name || spec.origin.deviceId)
      : null;

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
        origin:      onClient ? 'client' : 'server',
        originLabel: originName,
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
    originLabel: t.originLabel,
  }));
}

/**
 * Which machine a tool acts on, written for the model rather than for a person.
 *
 * The environment block already lists the servers and where they run, but that
 * is one line far from the point of decision: when the model picks between two
 * tools called `screenshot` it is reading *these* descriptions. Saying "on my
 * PC" has to be answerable from here, or it is answerable only by luck.
 *
 * Only added once some tool actually reaches a client. With everything on the
 * host there is nothing to disambiguate and the sentence would be per-tool
 * noise in a prompt rebuilt on every step. Note the trigger is *any* client
 * tool, not a mix of both: the built-in `shell` and `read_file` are always on
 * the host, so one client server is already an ambiguity even when it is the
 * only MCP server there is.
 */
function machineNote(t) {
  return t.origin === 'client'
    ? `Runs on "${t.originLabel}", a separate machine paired to DOCA. It acts on that machine — its files, screen, programs and its own localhost — not on the DOCA host, and your shell cannot see or check any of it.`
    : 'Runs on the DOCA host itself, the machine this dashboard and your shell tool are on.';
}

/** Tool declarations for the model, minus anything switched off. */
function schemas(disabled = []) {
  const all       = available();
  const anyClient = all.some(t => t.origin === 'client');

  return all
    .filter(t => !disabled.includes(t.exposed))
    .map(t => {
      const own = t.description || `${t.tool} (via the ${t.serverLabel} MCP server)`;
      return {
        type: 'function',
        function: {
          name:        t.exposed,
          description: anyClient ? `${own}\n\n${machineNote(t)}` : own,
          // A server may omit `type`, which some providers reject outright.
          parameters:  { type: 'object', properties: {}, ...t.schema },
        },
      };
    });
}

function isMcpTool(name) {
  return String(name || '').startsWith(`${PREFIX}${SEP}`);
}

/**
 * Run one MCP tool call. Like the built-in tools, failures come back as text so
 * the model can react to them instead of the turn dying.
 */
/**
 * Somebody else's "localhost" is not this machine's.
 *
 * A tool hosted by a client runs on that client, so when its bridge fails to
 * reach something it names an address on *that* box — "Cannot connect to Blender
 * at localhost:9876". Read here, where the shell and the filesystem are the DOCA
 * host's, that sentence is actively misleading: it invites checking a port on
 * the wrong machine, and it has cost this project real debugging time more than
 * once. The tool description already carries the machine (`machineNote`); this
 * puts it on the failure, which is where it is actually needed.
 *
 * Annotation only — the bridge's own words are never altered, because the exact
 * string is what a user searches for.
 */
const LOOPBACK = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?/i;

function placeError(text, t) {
  const body = String(text ?? '');
  if (t.origin !== 'client' || !LOOPBACK.test(body)) return body;
  const port = body.match(LOOPBACK)?.[2] || '';
  return `${body}\n\n[DOCA] That address is on "${t.originLabel}", the machine hosting this tool — not on `
    + `the DOCA host. Your shell, read_file and system_status cannot see it, and nothing you run here will `
    + `open it${port ? `: a process on ${t.originLabel} has to be listening on${port}` : ''}. If it needs `
    + 'starting, the person at that machine has to do it, or a tool on that machine does.';
}

async function call(name, args) {
  const t = available().find(x => x.exposed === name);
  if (!t) return `Error: no MCP tool named "${name}" — its server may have stopped.`;
  const c = registry.client(t.server);
  if (c?.state !== 'running') return `Error: the "${t.serverLabel}" MCP server is not running.`;
  try {
    // A tool that answers with isError reports its failure as content, so the
    // annotation belongs on the result as much as on a thrown one.
    return placeError(await c.callTool(t.tool, args || {}), t);
  } catch (e) {
    return placeError(`Error: ${e.message}`, t);
  }
}

module.exports = { available, describe, schemas, call, isMcpTool, placeError };
