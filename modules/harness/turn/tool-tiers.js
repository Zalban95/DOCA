'use strict';

/**
 * Tools sent by tier (TODO B2; graduated from the `toolTiers` experiment 2026-10-09, docs/experiments/tool-tiers.md).
 *
 * Every step re-sends the tool schemas, and most are for tools a turn never touches: 16.7k of the ~25k an Orchestrator
 * step cost on the owner's hive (56 built-ins), more with a phone's hands. The Orchestrator and work chats are sent the
 * core tools in full; the rest — rare built-ins and every MCP server's tools — are named in "Your tools", by kit and by
 * server, and attached for the conversation when they are needed: named in the person's message, named by a skill or
 * recipe the agent read, called by name, or asked for with `tools_more`. This narrows what is *sent*, never what is
 * *held*: a held tool called by name still runs (and is attached from then on). Specialists keep their own short
 * lists untouched; a spoken turn's front kit (front.js) is sent whole, only its MCP servers named; a conversation bound
 * to a project gets its code kit in full.
 *
 * `harness.config.doca.toolsLoading` decides: `tiers` (the default) or `all` — every held tool in full on every step,
 * as before, for a model with room to spare and a cache that makes the bytes cheap.
 */
const CORE = new Set([
  'work_chats', 'work_plan', 'agent_dispatch', 'agent_results', 'mission_plan', 'scout_report',
  'read_file', 'write_file', 'list_dir', 'search_files', 'shell', 'git', 'project', 'repo_rules',
  'memory_search', 'memory_write', 'recall_conversations', 'skill', 'recipe',
  'settings_read', 'settings_propose', 'panel_layout', 'install_propose', 'system_status', 'doca_clients',
  'ask_device', 'tell_device', 'show_media', 'form_fill', 'effort',
  'http_fetch', 'api_call', 'web_search', 'research_docs', 'mcp_connect', 'tools_more',
]);

/** How tools are sent: `tiers` (default) or `all` (harness.config.doca.toolsLoading). */
const mode = () => { try { return require('./params').params().toolsLoading === 'all' ? 'all' : 'tiers'; } catch { return 'tiers'; } };
const on = () => mode() === 'tiers';
const nameOf = s => s.function?.name || s.name;
/** An MCP tool's server id (`mcp__<server>__<tool>`), else null. */
const serverOf = n => (/^mcp__((?:[^_]|_(?!_))+)__/.exec(String(n)) || [])[1] || null;

/** Whether tiers apply to this turn: the setting, and the Orchestrator or a work chat (not a specialist). */
function applies(profile) { return on() && (!profile || profile.level === 'orchestrator'); }

function attached(sessionId) {
  try { return new Set(require('../memory').getSession(sessionId)?.toolsAttached || []); } catch { return new Set(); }
}

/** Whether a conversation is bound to a project, its own or up its parent chain (projects/store.forSession). */
function inProject(sessionId) {
  if (!sessionId) return false;
  try { return !!require('../../projects/store').forSession(sessionId); } catch { return false; }
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
function split(schemas, { sessionId = null, profile = null, text = '', client = null, step = false } = {}) {
  // A turn's step counts which way it was sent, so the alternative's use can be read (features/usage.js, review.js).
  if (step && (!profile || profile.level === 'orchestrator')) try { require('../../features/usage').count(`tools:${mode()}`); } catch { /* counting never stops a turn */ }
  if (!applies(profile)) return { offered: schemas, named: [] };
  // A spoken turn's front kit is already short and chosen (front.js): sent whole, only MCP servers named. A conversation
  // bound to a project does code work: its code tools (search, replace, git, project, the repository's rules) are sent.
  const front = !!client?.front, coding = inProject(sessionId), { kitOf } = require('../kits');
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
  for (const s of schemas) {
    const n = nameOf(s), builtin = !serverOf(n);
    (sent(n, have) || (builtin && (front || (coding && kitOf(n) === 'code'))) ? offered : named).push(s);
  }
  return { offered, named };
}

/**
 * What "Your tools" says of what is held but not sent: built-ins by name, grouped under their kit's label, and each
 * MCP server by id, how many tools and whether it is on another machine (a paired device hosts it).
 */
function namedLine(named) {
  if (!named.length) return '';
  const { KITS, kitOf } = require('../kits');
  const byKit = new Map(), servers = new Map();
  for (const s of named) {
    const n = nameOf(s), server = serverOf(n);
    if (server) { servers.set(server, (servers.get(server) || 0) + 1); continue; }
    const kit = kitOf(n) || 'other';
    if (!byKit.has(kit)) byKit.set(kit, []);
    byKit.get(kit).push(n);
  }
  const parts = [...Object.keys(KITS), 'other'].filter(k => byKit.has(k)).map(k => `${KITS[k]?.label || 'Other'}: ${byKit.get(k).join(', ')}`);
  for (const [id, c] of servers) parts.push(`mcp:${id} (${c} tool${c > 1 ? 's' : ''}${hostedElsewhere(id) ? ', on another machine' : ''})`);
  return `More tools you hold, not loaded yet — call one by name, or tools_more {names: [...]} to load it for this conversation:\n${parts.map(x => `  ${x}`).join('\n')}`;
}

/** Whether an MCP server is hosted by a paired client rather than this machine (mcp/registry origin). */
function hostedElsewhere(id) {
  try { return require('../../mcp/registry').load().some(d => d.id === id && d.origin?.kind === 'client'); } catch { return false; }
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

/** A tool this turn holds but was not sent (tiers): it still runs when called by name. */
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

module.exports = { heldNotSent, afterCall, CORE, applies, attach, attached, split, namedLine, mentionedIn, serverOf, mode };
