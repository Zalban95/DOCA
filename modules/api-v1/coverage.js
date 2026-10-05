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
 */
const HOST = 'the machine\'s own administration: a host\'s, at the panel';

const COVERAGE = {
  harness: { v1: ['/harness'] },
  chat: { v1: ['/harness'], note: 'the floating chat is a conversation like any other' },
  projects: { v1: ['/harness'], note: 'a project\'s chats are conversations; its files and git are the machine\'s', panel: HOST },
  attachments: { v1: ['/media', '/harness/images'] },
  devices: { v1: ['/devices'] },
  screen: { v1: ['/settings/effective'] },
  realtime: { v1: ['/realtime'] },
  clients: { v1: ['/clients'], note: 'the hub\'s own clients, to install and update' },
  recipes: { v1: ['/recipes'] },
  schedules: { v1: ['/schedules'] },
  face: { v1: ['/face'] },
  packs: { v1: ['/packs'], note: 'between hubs; making and bringing in packs is a host\'s' },
  presence: { v1: ['/events'], note: 'the panel saying it is looked at; a device\'s presence is its event stream' },
  branding: { panel: 'public, and read by clients as it is (GET /api/branding)' },
  auth: { panel: 'a person signing in to the panel; a device pairs instead (/devices)' },
  // The machine and DOCA itself.
  ...Object.fromEntries(['status', 'action', 'stack', 'logs', 'stats', 'configs', 'prefs', 'config-favorites', 'fm-favorites', 'paths', 'keys', 'skills',
    'setup', 'snapshots', 'files', 'host', 'experiments', 'settings', 'search', 'retrieval', 'vision', 'scout', 'assistant', 'evals', 'connectors', 'channels', 'computers', 'models',
    'system', 'update-check', 'update', 'restart', 'deps', 'versions', 'backups', 'startup', 'docker', 'mcp', 'vms', 'services'].map(g => [g, { panel: HOST }])),
};

module.exports = { COVERAGE };
