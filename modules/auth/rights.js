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
 *   chat    talk to the harness, attach files (editing its shared memory is host)
 *   propose apply a settings proposal the agent made
 *   host    anything that is the machine: shell, terminal, files, Docker, VMs,
 *           models, MCP servers, keys, logs — and anything that lets the agent
 *           do those (approving its tool calls, Auto mode, a specialist's tools)
 *   devices pair, rotate and revoke devices
 *   org     replace everyone's data or code: backups, versions, update, restart
 *   delegate make exceptions (grants) for people of your level or below
 * A role is a permission level (auth/levels.js): these four are the built-ins,
 * and an admin can make more, bound to the settings and tools they may touch.
 */
const ROLES = {
  viewer: ['read'],
  member: ['read', 'chat'],
  admin:  ['read', 'chat', 'propose', 'host', 'devices', 'users', 'delegate'],
  owner:  ['read', 'chat', 'propose', 'host', 'devices', 'users', 'org', 'delegate'],
};

/** Rights that need a sign-in within the last STEP_UP_HOURS. */
const STEP_UP = new Set(['host', 'users', 'org']);

const GET = 'GET', ANY = '*';
const R = (method, pattern, right) => ({ method, re: new RegExp(`^${pattern}$`), right });

const TABLE = [
  // ── The login page's own calls, and the account itself ──
  R(ANY, '/api/auth/(login|setup|state)', 'public'),
  R(GET, '/api/branding', 'public'),
  // A service's sign-in sends the browser back here from its own site, so the SameSite=Strict cookie stays behind;
  // what guards it is OAuth's state: one-time, ten minutes, minted only by a host's Connect (connectors/oauth.js).
  R(GET, '/api/connectors/callback', 'public'),
  R(GET, '/\\.well-known/agent(-card)?\\.json', 'public'),   // the A2A agent card: who the hive is and where to talk (api-v1/a2a.js)
  R(GET, '/api/auth/host-check', 'host'),                 // asked before opening a terminal socket
  R(ANY, '/api/auth/(me|logout|password|step-up|sessions)', 'signed'),
  R(ANY, '/api/auth/grants(/.*)?', 'signed'),              // exceptions: users or delegate, checked in users-routes.js
  R(ANY, '/api/auth/(users|levels)(/.*)?', 'users'),        // people and their permission levels (auth/users-routes.js)
  R(ANY, '/api/presence', 'signed'),                       // "this page is visible": a heartbeat, no data

  // ── The panel's own lifecycle: everyone's data and code ──
  R(ANY, '/api/backups(/.*)?', 'org'),
  R(ANY, '/api/versions/use', 'org'),
  R(GET, '/api/versions/[^/]+/notes', 'read'),                  // what a version added or fixed (release-notes.js)
  R(ANY, '/api/(update|restart)', 'org'),
  R(GET, '/api/deps', 'org'),                              // runs npm against the registry

  // ── Devices ──
  R(GET, '/api/devices', 'devices'),
  R(ANY, '/api/devices/[^/]+/files(/.*)?', 'host'),         // a device's disk is the machine, like the host's files
  R(ANY, '/api/devices/[^/]+/console/buttons', 'host'),     // a button's `run` is a command on this machine
  R(ANY, '/api/devices(/.*)?', 'devices'),

  // ── The harness: what lets the agent act on the machine is host ──
  R(ANY, '/api/harness/approvals/[^/]+', 'chat'),          // answering a tool call: a host, or the person whose turn it is (routes.js)
  R(GET, '/api/harness/approval', 'chat'),                   // the mode, for the chat's pill; the rest of it only to a host (routes.js)
  R(ANY, '/api/harness/approval(/.*)?', 'host'),           // Auto/Manual, and the always-allowed list
  R(ANY, '/api/harness/agents(/.*)?', 'host'),             // a specialist's definition is its tool list
  R(ANY, '/api/harness/installs/[^/]+/(apply|reject)', 'host'),
  R(ANY, '/api/harness/(custom|default)(/.*)?', 'host'),
  R(ANY, '/api/harness/contracts/[^/]+', 'host'),          // forgetting what a provider was found to accept
  R(ANY, '/api/harness/[^/]+/(config|install)', 'host'),
  R(ANY, '/api/harness/proposals/[^/]+/(apply|reject)', 'chat'),   // the hive's need `propose`; one for a person's own screen is theirs (routes.js mayDecide)
  R(ANY, '/api/harness/previews', 'host'),                 // shows a localhost port to the tailnet
  R(ANY, '/api/harness/guards(/.*)?', 'host'),             // what the agents may read (guard/)
  R(ANY, '/api/harness/questions/[^/]+', 'chat'),          // answering what the agent asked
  R(ANY, '/api/harness/canvases/[^/]+', 'chat'),           // deleting one (reading is a GET below)
  R(ANY, '/api/harness/usage/prices', 'chat'),              // the owner's price list: display only, changes nothing the agent does
  R(GET, '/api/harness(/.*)?', 'read'),
  // The agent's durable memory is one for everybody until per-person memory (auth phase 3): a member
  // deleting or locking the owner's facts was found by the live test 2026-10-04. Reading is read, above.
  R(ANY, '/api/harness/memory(/.*)?', 'host'),
  R(ANY, '/api/harness/(chat|sessions|memory|missions|working|work|seen)(/.*)?', 'chat'),   // seen: a person's own result opened (seen.js)

  // ── The floating chat and attachments ──
  R(GET, '/api/chat/(history|status|call-status|voices)', 'read'),
  R(ANY, '/api/chat(/.*)?', 'chat'),
  R(GET, '/api/attachments(/.*)?', 'read'),
  R(ANY, '/api/attachments', 'chat'),

  // ── Looking ──
  R(GET, '/api/(status|stats/defs|update-check|versions|startup|prefs|paths)', 'read'),
  R(GET, '/api/host/capabilities', 'read'),                 // what this host can do, per OS (host-capabilities.js)
  R(GET, '/api/settings/migrations', 'read'),               // prefs migrations: key names and code defaults, never a stored value
  R(GET, '/api/(services|services/status|vms|system/tools|mcp|skills|skills/search|skills/[^/]+)', 'read'),
  R(GET, '/api/docker/(containers|images|presets)', 'read'),
  R(GET, '/api/decisions', 'read'),   // each person's own decisions; a host's also the hive's (decisions.js)
  R(GET, '/api/models(/(disk|settings|tools|servers|roles|hf/(list|search|settings|status)|local/(list|search|settings)|llamacpp/(list|status)|ollama/(list|running|search|status)))?', 'read'),

  // ── Everything else is the machine ──
  R(ANY, '/api/(files|fm-favorites|configs|config-favorites|keys|logs|setup|snapshots|stack|action)(/.*)?', 'host'),
  R(ANY, '/api/projects(/.*)?', 'host'),
  R(ANY, '/api/computers(/.*)?', 'host'),
  R(ANY, '/api/search/(settings|try)', 'host'),                // the web search provider and its key (search/routes.js)
  R(ANY, '/api/screen(/settings|/profile)?', 'read'),          // one's own screen or device: how it looks and when it is asked, never how the hive behaves (screens/)
  R(ANY, '/api/sharing(/.*)?', 'host'),                        // the owner's answer and the owner's click (sharing.js)
  R(ANY, '/api/packs(/.*)?', 'host'),                          // packs carry MCP commands, tool lists and memory (packs/routes.js)
  R(ANY, '/api/schedules(/.*)?', 'chat'),                     // one's own schedules; a host's, every one (schedules/routes.js)
  R(GET, '/api/live/stream', 'read'),                           // every page live: changes this viewer may open (live/routes.js)
  R(ANY, '/api/live/watch', 'host'),
  R(ANY, '/api/screens/.*', 'host'),
  R(ANY, '/api/archive(/.*)?', 'chat'),
  R(GET, '/api/chronicle(/.*)?', 'read'),                      // what happened: each row the viewer's own unless host (chronicle/)
  R(ANY, '/api/workstream(/.*)?', 'host'),
  R(ANY, '/api/machines(/.*)?', 'host'),
  R(GET, '/api/hub/links', 'read'),                              // the hub's addresses, as QR codes a phone scans (network.js)
  R(ANY, '/api/network', 'org'),                                 // how the hub listens: the machine's front door (network.js)                         // the agents' machines and the pages they serve (machines/)                       // the agents' work as it happens: the machine's files, every conversation (workstream/)                          // what was put away: each person's own; projects and computers a host's (archive.js)                             // what each screen shows, and sending it a page (screens/showing.js)                            // which folders this page shows: Files and Projects are a host's
  R(GET, '/api/wakeword/(models/[^/]+/model\\.onnx|runtime/[^/]+)', 'read'),   // a screen listening for its name reads its model (wakeword/)
  R(ANY, '/api/wakeword(/.*)?', 'host'),                       // setting up, recording, training: downloads, GPU hours, a microphone's audio
  R(GET, '/api/ambient(/.*)?', 'read'),                        // the ambient screen: weather, the day's plan and notices, each the viewer's own (ambient/)
  R(GET, '/api/face/stream', 'chat'),                          // the face's feed, scoped to what the viewer may open (face/state.js)
  R(ANY, '/api/developer(/.*)?', 'host'),                        // who may release unasked (releasing.js): the admin's
  R(ANY, '/api/experiments(/.*)?', 'host'),                     // the owner's switches for experiments (experiments.js)
  R(ANY, '/api/features(/.*)?', 'host'),                        // the feature index, usage, and hiding an unused alternative (features/)
  R('POST', '/api/recipes/[^/]+/(accept|discard)', 'host'),     // a repaired revision becomes automation: a host's call
  R('DELETE', '/api/recipes/[^/]+', 'host'),                   // a recipe the hive shares (recipes/routes.js)
  R(ANY, '/api/recipes(/.*)?', 'chat'),                       // reading, saving and running one: as the signed-in person
  R('POST', '/api/channels/telegram', 'host'),               // the bot's token and switch: it answers as the hive
  R(ANY, '/api/channels/telegram(/.*)?', 'chat'),             // a link code, and one's own linked chats (channels/telegram/routes.js)
  R('POST', '/api/channels/matrix', 'host'),                 // the homeserver, the bot's token and switch
  R(ANY, '/api/channels/matrix(/.*)?', 'chat'),               // a link code, and one's own linked rooms (channels/matrix/routes.js)
  R(ANY, '/api/evals(/.*)?', 'host'),
  R(ANY, '/api/connectors(/.*)?', 'host'),                    // the keys to the owner's accounts (connectors/routes.js)                         // evaluation sets: a run spends tokens, results hold answers (evals/routes.js)
  R(GET, '/api/clients/browser.zip', 'read'),
  R(GET, '/api/clients/apps/[a-z]+/apk/[A-Za-z0-9_-]{32}', 'public'),   // a 10-minute download link: its token is the permission (client-apps/routes.js)
  R(GET, '/api/clients/apps(/.*)?', 'read'),                 // DOCA's Android apps: what is kept, and the APK (client-apps/)
  R(ANY, '/api/clients/apps(/.*)?', 'host'),                 // uploading, building and the signing key are a host's               // the DOCA browser extension, to install (api-v1/client-files.js)
  R(GET, '/api/harness/opendots/state', 'read'),            // whether OpenDots is installed, set up and answering (harness/opendots.js)
  R(ANY, '/api/harness/opendots(/.*)?', 'host'),             // its folder, address and Compose project: the machine's
  R(GET, '/api/realtime', 'chat'),                           // what a live call would use (realtime/routes.js; the call is /ws/realtime)
  R(ANY, '/api/realtime', 'host'),                           // the owner chooses the realtime voice service
  R(ANY, '/api/settings/checkpoints(/.*)?', 'host'),          // every saved settings version, and putting one back (checkpoints.js)
  R(GET, '/api/assistant', 'read'),                          // assistant mode's style, effort and model (harness/assistant-routes.js)
  R(ANY, '/api/assistant', 'host'),
  R(ANY, '/api/scout(/.*)?', 'host'),                         // the model scout: suggestions, accepting into TODO, starting the work (scout/routes.js)
  R(GET, '/api/vision', 'read'),                             // which screen readers are set up (vision/routes.js)
  R(ANY, '/api/vision(/.*)?', 'host'),                        // choosing them, trying one
  R(GET, '/api/retrieval', 'read'),                          // the embedding model and what the index holds (retrieval/routes.js)
  R(ANY, '/api/retrieval(/.*)?', 'host'),                     // choosing the model, trying it, emptying the index
  R('POST', '/api/channels/mail', 'host'),                   // the mailbox and its password
  R(ANY, '/api/channels/mail(/.*)?', 'chat'),                 // a link code, and one's own linked addresses
  R('POST', '/api/channels/slack', 'host'),                  // the Slack app's two tokens and the switch
  R(ANY, '/api/channels/slack(/.*)?', 'chat'),                // a link code, and one's own linked DMs (channels/routes.js)
  R(GET, '/computers/[a-f0-9]+/vnc(/.*)?', 'host'),         // a computer's screen, proxied (computers/vnc.js)                  // computers for agents: containers on this machine (computers/)                   // a project is files and a shell
  R(ANY, '/api/harness/(agent-import|identity|skills/import)', 'host'),
  R('POST', '/api/harness/skills(/draft)?', 'host'),             // a skill is instructions the agent follows: drafted, read and saved by a host (harness/learn.js)
  R(ANY, '/api/harness/skills/[^/]+/(adapt|restore)', 'host'),  // rewriting a skill is rewriting instructions the agent follows  // who the agents are: persona.md, human.md, definitions
  R(ANY, '/api/(docker|vms|models|services|mcp|skills|system|paths|prefs|startup)(/.*)?', 'host'),
];

/** The right a request needs, or null when no row matches — which denies it. */
function rightFor(method, p) {
  for (const row of TABLE) if ((row.method === ANY || row.method === method) && row.re.test(p)) return row.right;
  return null;
}

/** Whether a level holds a right — built-in or one an admin made (auth/levels.js). Unknown: no. */
function can(role, right) { return require('./levels').rightsOf(role).includes(right); }

module.exports = { ROLES, STEP_UP, TABLE, rightFor, can };
