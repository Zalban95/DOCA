'use strict';

/**
 * Which right each route needs, and which roles hold which rights.
 *
 * One table, read top to bottom, first match wins — and a route that matches
 * nothing is **denied**. A route added later without a thought about rights
 * fails closed, and test/auth-rights.test.js lists every route the app has and
 * fails when one is not in here.
 *
 * Rights are about what a route can *do*, not what it is called:
 *   public  no session needed (the login page's own calls)
 *   signed  any signed-in person (their own account)
 *   read    look: status, transcripts, lists
 *   chat    talk to the harness, keep its memory, attach files
 *   propose apply a settings proposal the agent made
 *   host    anything that is the machine: shell, terminal, files, Docker, VMs,
 *           models, MCP servers, keys, logs — and anything that lets the agent
 *           do those (approving its tool calls, Auto mode, a specialist's tools)
 *   devices pair, rotate and revoke devices
 *   org     replace everyone's data or code: backups, versions, update, restart
 */
const ROLES = {
  viewer: ['read'],
  member: ['read', 'chat'],
  admin:  ['read', 'chat', 'propose', 'host', 'devices', 'users'],
  owner:  ['read', 'chat', 'propose', 'host', 'devices', 'users', 'org'],
};

/** Rights that need a sign-in within the last STEP_UP_HOURS. */
const STEP_UP = new Set(['host', 'users', 'org']);

const GET = 'GET', ANY = '*';
const R = (method, pattern, right) => ({ method, re: new RegExp(`^${pattern}$`), right });

const TABLE = [
  // ── The login page's own calls, and the account itself ──
  R(ANY, '/api/auth/(login|setup|state)', 'public'),
  R(GET, '/api/branding', 'public'),
  R(GET, '/api/auth/host-check', 'host'),                 // asked before opening a terminal socket
  R(ANY, '/api/auth/(me|logout|password|step-up|sessions)', 'signed'),

  // ── The panel's own lifecycle: everyone's data and code ──
  R(ANY, '/api/backups(/.*)?', 'org'),
  R(ANY, '/api/versions/use', 'org'),
  R(ANY, '/api/(update|restart)', 'org'),

  // ── Devices ──
  R(GET, '/api/devices', 'devices'),
  R(ANY, '/api/devices(/.*)?', 'devices'),

  // ── The harness: what lets the agent act on the machine is host ──
  R(ANY, '/api/harness/approvals/[^/]+', 'host'),          // approving a tool call it asked to run
  R(ANY, '/api/harness/approval(/.*)?', 'host'),           // Auto/Manual, and the always-allowed list
  R(ANY, '/api/harness/agents(/.*)?', 'host'),             // a specialist's definition is its tool list
  R(ANY, '/api/harness/installs/[^/]+/(apply|reject)', 'host'),
  R(ANY, '/api/harness/(custom|default)(/.*)?', 'host'),
  R(ANY, '/api/harness/[^/]+/(config|install)', 'host'),
  R(ANY, '/api/harness/proposals/[^/]+/(apply|reject)', 'propose'),
  R(ANY, '/api/harness/questions/[^/]+', 'chat'),          // answering what the agent asked
  R(GET, '/api/harness(/.*)?', 'read'),
  R(ANY, '/api/harness/(chat|sessions|memory|missions)(/.*)?', 'chat'),

  // ── The floating chat and attachments ──
  R(GET, '/api/chat/(history|status|call-status)', 'read'),
  R(ANY, '/api/chat(/.*)?', 'chat'),
  R(GET, '/api/attachments(/.*)?', 'read'),
  R(ANY, '/api/attachments', 'chat'),

  // ── Looking ──
  R(GET, '/api/(status|stats/defs|update-check|versions|startup|prefs|paths)', 'read'),
  R(GET, '/api/(services|services/status|vms|system/tools|mcp|skills|skills/search|skills/[^/]+)', 'read'),
  R(GET, '/api/docker/(containers|images|presets)', 'read'),
  R(GET, '/api/models(/(disk|settings|tools|hf/(list|search|settings|status)|local/(list|search|settings)|llamacpp/(list|status)|ollama/(list|running|search|status)))?', 'read'),

  // ── Everything else is the machine ──
  R(ANY, '/api/(files|fm-favorites|configs|config-favorites|keys|logs|setup|snapshots|stack|action)(/.*)?', 'host'),
  R(ANY, '/api/(docker|vms|models|services|mcp|skills|system|paths|prefs|startup)(/.*)?', 'host'),
];

/** The right a request needs, or null when no row matches — which denies it. */
function rightFor(method, p) {
  for (const row of TABLE) if ((row.method === ANY || row.method === method) && row.re.test(p)) return row.right;
  return null;
}

function can(role, right) { return !!ROLES[role]?.includes(right); }

module.exports = { ROLES, STEP_UP, TABLE, rightFor, can };
