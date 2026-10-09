'use strict';

/**
 * Every capability lands in /api/v1 first (TODO H11.3; hive.md: a client should have what the panel has). This is
 * where that is checked rather than remembered: each group of the panel's own routes (`/api/<group>/…`) says where a
 * device finds the same capability, or why it is the panel's alone. test/api-coverage.test.js walks every route the
 * app registers and fails on a group without a row, so a new capability cannot land without its author deciding this.
 *
 *   v1     the /api/v1 path(s) that serve it to a device
 *   panel  why a device does not get its own route: mostly the machine's own administration, a host's at the panel
 *          (a device that needs it opens the panel itself, /d/<id>/, in its web view)
 *
 * A group answers for its reads; what a person DOES is checked one action at a time in capability-map.js (TODO D2b),
 * where a group with a v1 home cannot hide an action that has none.
 */
const HOST = 'the machine\'s own administration: a host\'s, at the panel';

const COVERAGE = {
  harness: { v1: ['/harness'] },
  chat: { v1: ['/harness'], note: 'the floating chat is a conversation like any other' },
  projects: { v1: ['/harness'], note: 'a project\'s chats are conversations; its files and git are the machine\'s', panel: HOST },
  attachments: { v1: ['/media', '/harness/images'] },
  devices: { v1: ['/devices'] },
  screen: { v1: ['/settings/effective', '/settings/look'] },
  realtime: { v1: ['/realtime'] },
  hub: { v1: ['/hub/links'], note: 'the hub\'s addresses: a device keeps them all; the QR codes are the panel\'s' },
  clients: { v1: ['/clients'], note: 'the hub\'s own clients, to install and update' },
  recipes: { v1: ['/recipes'] },
  schedules: { v1: ['/schedules'] },
  face: { v1: ['/face'] },
  admin: { panel: HOST, note: 'Hub → Admin: the hive at a glance for its admin; each line links to where it is handled' },
  archive: { v1: ['/harness/sessions/{id}/archive', '/harness/missions/{id}/archive'], note: 'projects and computers are the machine\'s', panel: HOST },
  live: { v1: ['/events'], note: 'a device already hears turns, missions and work chats change on its event stream; watching a folder is the machine\'s' },
  packs: { v1: ['/packs'], note: 'between hubs; making and bringing in packs is a host\'s' },
  spending: { panel: 'budgets and spending permissions change only with the password, at the panel (CONSTITUTION S12, S14); a device reads its tokens at /harness/usage and opens the panel (/d/<id>/) for the rest' },
  sharing: { panel: 'the owner\'s answer and click to offer what was learned to the project (CONSTITUTION §0); a host\'s alone' },
  guided: { panel: 'setting up this machine (what it can bear, what to install, which keys to paste): the owner\'s, at the panel' },
  presence: { v1: ['/events'], note: 'the panel saying it is looked at; a device\'s presence is its event stream' },
  'system-one': { panel: 'the System 1 decision model is the hub\'s own (experiment systemOne): its service is a process on this machine, its decisions are made inside turns a device already starts' },
  wakeword: { v1: ['/wakeword'], note: 'a device downloads kept models and the runtime; training stays the hub\'s' },
  ambient: { v1: ['/ambient'], note: 'the person\'s day; the screen itself is the panel\'s page' },
  notices: { v1: ['/events'], note: 'a device gets a notice as an `alert` on its event stream; this is the panel\'s own list of them' },
  home: { panel: 'the Home page, drawn from Home Assistant by the hub (home/); a device\'s own /api/v1 home is a later step — capability-gaps.md, home' },
  decisions: { v1: ['/decisions'] },
  library: { v1: ['/harness'], note: 'a device searches its person\'s Library through the agent (library_search); choosing folders and indexing are the machine\'s', panel: HOST },
  chronicle: { v1: ['/harness', '/jobs/{id}'], note: 'a device reads its conversations, missions and jobs there; reading them all back as one story is the panel\'s page' },
  branding: { panel: 'public, and read by clients as it is (GET /api/branding)' },
  auth: { panel: 'a person signing in to the panel; a device pairs instead (/devices)' },
  licence: { panel: 'which features this hive may run, and renewing its licence: the owner\'s, at the panel (license/)' },
  // The machine and DOCA itself.
  ...Object.fromEntries(['status', 'action', 'stack', 'logs', 'stats', 'configs', 'prefs', 'config-favorites', 'fm-favorites', 'paths', 'keys', 'skills',
    'setup', 'snapshots', 'files', 'host', 'experiments', 'features', 'developer', 'screens', 'workstream', 'machines', 'network', 'settings', 'search', 'retrieval', 'vision', 'scout', 'assistant', 'evals', 'connectors', 'channels', 'computers', 'models',
    'system', 'update-check', 'update', 'restart', 'deps', 'versions', 'backups', 'startup', 'docker', 'mcp', 'vms', 'services'].map(g => [g, { panel: HOST }])),
};

module.exports = { COVERAGE };
