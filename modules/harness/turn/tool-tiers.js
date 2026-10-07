'use strict';

/**
 * Tools sent by tier (experiment `toolTiers`, docs/experiments/tool-tiers.md; audit 2026-10-06, aw 25, coh F4; TODO B2).
 *
 * A bare install sent ≈12k tokens of tool schemas on every step, most for tools a turn never touches, and a phone's
 * hands added 21 more. With the flag on, the Orchestrator and work chats are sent the core tools in full; the rest —
 * rare built-ins and every MCP server's tools — are named on one line of "Your tools" and attached for the
 * conversation when they are needed: named in the person's message, named by a skill or recipe the agent read, called
 * by name, or asked for with `tools_more`. This narrows what is *sent*, never what is *held*: a held tool called by
 * name still runs (and is attached from then on). Specialists keep their own short lists untouched.
 */
const CORE = new Set([
  'work_chats', 'work_plan', 'agent_dispatch', 'agent_results', 'mission_plan', 'scout_report',
  'read_file', 'write_file', 'list_dir', 'search_files', 'shell', 'git', 'project', 'repo_rules',
  'memory_search', 'memory_write', 'recall_conversations', 'skill', 'recipe',
  'settings_read', 'settings_propose', 'install_propose', 'system_status', 'doca_clients',
  'ask_device', 'tell_device', 'show_media', 'form_fill', 'effort',
  'http_fetch', 'api_call', 'web_search', 'research_docs', 'mcp_connect', 'tools_more',
]);

const on = () => require('../../experiments').on('toolTiers');
const nameOf = s => s.function?.name || s.name;
/** An MCP tool's server id (`mcp__<server>__<tool>`), else null. */
const serverOf = n => (/^mcp__((?:[^_]|_(?!_))+)__/.exec(String(n)) || [])[1] || null;

/** Whether tiers apply to this turn: the flag, and the Orchestrator or a work chat (not a specialist). */
function applies(profile) { return on() && (!profile || profile.level === 'orchestrator'); }

function attached(sessionId) {
  try { return new Set(require('../memory').getSession(sessionId)?.toolsAttached || []); } catch { return new Set(); }
}

/** Attach tools (names) or whole MCP servers (`mcp:<id>`) to a conversation; returns what was new. */
function attach(sessionId, names = []) {
  if (!sessionId || !names.length) return [];
  const had = attached(sessionId);
  const fresh = names.filter(n => n && !had.has(n));
  if (!fresh.length) return [];
  try { require('../memory').updateSession(sessionId, { toolsAttached: [...had, ...fresh] }); } catch { return []; }
  return fresh;
}

/** Whether one schema is sent this step. */
function sent(name, have) {
  if (CORE.has(name) || name.startsWith('connector_') || have.has(name)) return true;
  const server = serverOf(name);
  return !!server && have.has(`mcp:${server}`);
}

/**
 * Split a turn's schemas into what is sent and what is only named. `text` (the person's message) attaches what it
 * names: a tool by its name, an MCP server by its id.
 */
function split(schemas, { sessionId = null, profile = null, text = '' } = {}) {
  if (!applies(profile)) return { offered: schemas, named: [] };
  const words = String(text || '');
  const mentioned = [];
  for (const s of schemas) {
    const n = nameOf(s), server = serverOf(n);
    if (!CORE.has(n) && words.includes(n)) mentioned.push(n);
    if (server && words.includes(server)) mentioned.push(`mcp:${server}`);
  }
  attach(sessionId, [...new Set(mentioned)]);
  const have = attached(sessionId);
  for (const m of mentioned) have.add(m);
  const offered = [], named = [];
  for (const s of schemas) (sent(nameOf(s), have) ? offered : named).push(s);
  return { offered, named };
}

/** The one line "Your tools" gives what is held but not sent: built-ins by name, MCP servers by id and count. */
function namedLine(named) {
  if (!named.length) return '';
  const builtin = [], servers = new Map();
  for (const s of named) {
    const n = nameOf(s), server = serverOf(n);
    if (server) servers.set(server, (servers.get(server) || 0) + 1);
    else builtin.push(n);
  }
  const parts = [];
  if (builtin.length) parts.push(builtin.join(', '));
  for (const [id, c] of servers) parts.push(`mcp:${id} (${c} tools)`);
  return `More tools you hold, not loaded yet — tools_more {names: [...]} loads them for this conversation (or call one by name): ${parts.join('; ')}.`;
}

/** Tool names (and `mcp:<id>`) a text mentions, among those held — for a skill or recipe the agent just read. */
function mentionedIn(text, heldNames = []) {
  const t = String(text || '');
  const out = new Set();
  for (const n of heldNames) {
    if (CORE.has(n)) continue;
    const server = serverOf(n);
    if (t.includes(n)) out.add(n);
    else if (server && t.includes(`mcp__${server}__`)) out.add(`mcp:${server}`);
  }
  return [...out];
}

/** A tool this turn holds but was not sent (tiers on): it still runs when called by name. */
function heldNotSent(name, disabled = []) {
  if (!on() || disabled.includes(name)) return false;
  return require('../tools').schemas(disabled).some(s => nameOf(s) === name);
}

/** After a call: a tool called by name stays loaded; a skill or recipe read loads the tools it names. */
function afterCall(sessionId, profile, name, result, disabled = []) {
  if (!applies(profile) || !sessionId) return;
  const add = [];
  if (!CORE.has(name)) add.push(serverOf(name) ? `mcp:${serverOf(name)}` : name);
  if ((name === 'skill' || name === 'recipe') && !String(result).startsWith('Error'))
    add.push(...mentionedIn(result, require('../tools').schemas(disabled).map(nameOf)));
  attach(sessionId, add);
}

module.exports = { heldNotSent, afterCall, CORE, applies, attach, attached, split, namedLine, mentionedIn, serverOf };
