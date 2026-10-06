'use strict';

/**
 * Kits: the harness's tools in families, and which family each tool is in.
 *
 * An agent holds kits, not tool lists (docs/design/agents-and-tools.md): the
 * Orchestrator and its work chats hold every kit, a specialist the kits its
 * definition names. So a tool added to a kit in a later release reaches every
 * agent holding that kit — nothing to edit, nothing to migrate — and a new
 * tool that is in no kit fails `test/kits.test.js`, which is what makes
 * "tell the agents" part of adding one.
 *
 * What a tool is for is its own description's first sentence, written beside
 * the tool; the prompt's "Your tools" section is generated from these and the
 * registry (./turn/tools-section.js), never kept by hand.
 */

const KITS = {
  organization: { label: 'Organization', about: 'hand work to work chats and specialists, and follow it' },
  code:         { label: 'Code',         about: 'projects: search, replace across files, git, build and test' },
  files:        { label: 'Files',        about: 'read, write and list files' },
  shell:        { label: 'Shell',        about: 'run commands, and long ones in the background' },
  canvas:       { label: 'Canvas',       about: 'pages beside the chat, and previews of local servers' },
  web:          { label: 'Web',          about: 'search the web, fetch pages and read documentation' },
  memory:       { label: 'Memory',       about: 'what you know across conversations, and its rules' },
  devices:      { label: 'Devices',      about: 'reach the person on their phone, watch and desk; show media' },
  panel:        { label: 'Panel',        about: 'this panel\'s state and settings, which you propose' },
  skills:       { label: 'Skills',       about: 'procedures to load when a task matches, recipes to run again without the thinking, and to keep what you learn' },
  mcp:          { label: 'MCP',          about: 'tools from MCP servers running now' },
  connectors:   { label: 'Connectors',   about: 'the accounts the owner connected (GitHub, Google, Microsoft…), through their own APIs (connectors/)' },
  computer:     { label: 'Computer',     about: 'a Linux desktop in a container: shell, files, screen, a real browser, recording (computers/)' },
};

/** Every built-in tool's kit. A tool missing here fails the test — on purpose. */
const KIT_OF = {
  work_chats: 'organization', work_plan: 'organization', agent_dispatch: 'organization',
  agent_results: 'organization', agent_resume: 'organization', schedule: 'organization', computer: 'computer', computer_login: 'computer', computer_look: 'computer', permission_grant: 'organization', mission_plan: 'organization', scout_report: 'organization', scout: 'organization',
  search_files: 'code', replace_in_files: 'code', git: 'code', project: 'code', repo_rules: 'code',
  read_file: 'files', write_file: 'files', list_dir: 'files',
  shell: 'shell', shell_job: 'shell',
  canvas: 'canvas',
  http_fetch: 'web', research_docs: 'web', web_search: 'web',
  memory_write: 'memory', memory_rules_write: 'memory', memory_search: 'memory', memory_list: 'memory',
  memory_forget: 'memory', memory_flag: 'memory', recall_conversations: 'memory',
  ask_device: 'devices', tell_device: 'devices', doca_clients: 'devices', show_media: 'devices', show_image: 'devices', today: 'devices',
  skill: 'skills', tools_more: 'skills', tool_note: 'skills', recipe: 'skills', pack: 'skills',
  settings_read: 'panel', effort: 'panel', form_fill: 'panel', settings_propose: 'panel', install_propose: 'panel', mcp_draft: 'panel', service_draft: 'panel', system_status: 'panel', mcp_status: 'panel', mcp_connect: 'panel',
};

/** A tool's kit: its own entry, an MCP server's tool, or none. */
function kitOf(name) {
  if (KIT_OF[name]) return KIT_OF[name];
  if (/^mcp__computer-[a-f0-9]+__/.test(name)) return 'computer';   // a computer's own tools (modules/computers)
  if (/^connector_[a-z]/.test(name)) return 'connectors';            // a connected account (modules/connectors)
  try { if (require('../mcp/tools').isMcpTool(name)) return 'mcp'; } catch { /* no MCP */ }
  return null;
}

/**
 * The tools an agent type holds: every tool in `kits` ('*' for all), plus
 * `add`, minus `remove`. `all` is the registry's list of names.
 */
function expand({ kits = [], add = [], remove = [] } = {}, all) {
  const every = kits === '*' || (Array.isArray(kits) && kits.includes('*'));
  const set = new Set(all.filter(n => every || kits.includes(kitOf(n))));
  for (const n of add) if (all.includes(n)) set.add(n);
  for (const n of remove) set.delete(n);
  return [...set];
}

module.exports = { KITS, KIT_OF, kitOf, expand };
