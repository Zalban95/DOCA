'use strict';

/**
 * The shipped panel, as the hub knows it: its pages (NAV_TABS in public/js/nav.js), their groups and names
 * (NAV_GROUPS, NAV_LABELS in public/js/nav-groups.js). The browser draws today's panel from its own copy before
 * anything is fetched — so a screen that cannot reach /api/screen/layout is exactly the panel it always was — and
 * the hub reads this one to resolve a person's layout and to tell the agent what exists. test/panel-layout.test.js
 * holds the two copies equal.
 */
const PAGES = ['controls', 'people', 'meetings', 'home', 'ambient', 'admin', 'logs', 'files', 'projects', 'harness', 'workstream', 'archive', 'chronicle', 'computers', 'live', 'terminal',
  'models', 'docker', 'vms', 'vnc', 'mcp', 'connectors', 'apikeys', 'settings'];

/** Pages that are the machine itself: a person without host never has them, in a group or inside a view. */
const HOST_PAGES = ['admin', 'logs', 'files', 'projects', 'terminal', 'computers', 'vnc'];

const GROUPS = [
  { id: 'controls', label: 'Controls', icon: '▶', tabs: ['controls', 'people', 'meetings', 'home', 'ambient'] },
  { id: 'agents', label: 'Agents', icon: '⬡', tabs: ['harness', 'workstream', 'projects', 'archive', 'chronicle'] },
  { id: 'machines', label: 'Machines', icon: '🖵', tabs: ['live', 'computers', 'vms', 'vnc', 'docker'] },
  { id: 'host', label: 'Hub', icon: '⌨', tabs: ['admin', 'files', 'terminal', 'logs'] },
  { id: 'intelligence', label: 'Field', icon: '◆', tabs: ['models', 'mcp', 'connectors', 'apikeys'] },
  { id: 'settings', label: 'Settings', icon: '⚙', tabs: ['settings'] },
];

const LABELS = { controls: 'Overview', people: 'Chat', meetings: 'Meetings', admin: 'Admin', home: 'Home', ambient: 'Ambient', harness: 'Harness', workstream: 'Workstream', projects: 'Projects', archive: 'Archive', chronicle: 'Chronicle',
  computers: 'Computers', live: 'Live', vms: 'VMs', vnc: 'VNC', docker: 'Docker', files: 'Files', terminal: 'Terminal', logs: 'Logs', models: 'Models',
  mcp: 'MCP', connectors: 'Connectors', apikeys: 'API keys', settings: 'Settings' };

/** The theme tokens a layout may set (public/js/themes.js THEME_CSS_KEYS, plus the type and shape ones). */
const STYLE_VARS = ['--bg', '--surface', '--raised', '--dim', '--faint', '--border', '--border2', '--text', '--muted', '--bright',
  '--accent', '--green', '--red', '--blue', '--purple', '--teal', '--cyan', '--amber', '--bg-green', '--bg-red', '--bg-blue', '--bg-amber',
  '--bg2', '--bg3', '--text-muted', '--font-mono', '--font-ui', '--font-text', '--font-display', '--radius', '--sidebar-w'];

const DENSITIES = ['compact', 'normal', 'roomy'];

module.exports = { PAGES, HOST_PAGES, GROUPS, LABELS, STYLE_VARS, DENSITIES };
