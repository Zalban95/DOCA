'use strict';

/**
 * What a person can DO in the panel, and where a device does the same (TODO D2b; CONSTITUTION: every capability lands
 * in /api/v1 first, so a client can have it). coverage.js answers by path prefix — "/api/harness/* is the harness" —
 * which let a group with a v1 home hide an action that has none: stopping a specialist stayed a panel button until 2.257.0
 * under a group that read as covered. Here each row is one thing a person does, named in their words:
 *
 *   id     short and stable; docs/api/capability-gaps.md names every gap by it
 *   does   the capability, as a person would say it
 *   panel  the panel routes that do it ("METHOD /api/path", express params; a trailing /* is every route below it)
 *   v1     the /api/v1 routes that do it for a device ("METHOD /path", as in the OpenAPI document)
 *   gap    no v1 route yet: its rank by how much a phone or watch person misses it (1 = most), `why` says what for;
 *          `ask` marks one whose filling widens what a device may do (CONSTITUTION S11/W3: the owner decides first)
 *   only   why it is the panel's alone (the machine's own administration mostly: capability-map-host.js)
 *
 * test/api-coverage.test.js walks every route the app registers: a route that changes something belongs to exactly one
 * capability (an exact pattern wins over a /* one), every pattern still matches a route, and every v1 route named is in
 * the OpenAPI document with that method. Reads may be listed too; they are not required.
 */
const HOST = require('./capability-map-host');

const PERSON = [
  // ── Conversations ──
  { id: 'talk', does: 'talk to the agent', panel: ['POST /api/harness/chat', 'POST /api/chat'], v1: ['POST /harness/messages'] },
  { id: 'project-talk', does: 'talk in a project\'s chat', panel: ['POST /api/projects/:id/chat'], v1: ['POST /harness/messages'],
    note: 'a project\'s chat is a conversation; a device names it by its id' },
  { id: 'conversation-new', does: 'start a conversation', panel: ['POST /api/harness/sessions', 'POST /api/chat/clear'], v1: ['POST /harness/sessions'],
    note: 'the floating chat\'s Clear starts its conversation afresh' },
  { id: 'conversation-open', does: 'switch to a conversation', panel: ['POST /api/harness/sessions/:id/activate'], v1: ['POST /harness/sessions/{id}/activate'] },
  { id: 'conversation-read', does: 'read my conversations', panel: ['GET /api/harness/sessions', 'GET /api/harness/sessions/:id'], v1: ['GET /harness/sessions', 'GET /harness/sessions/{id}'] },
  { id: 'conversation-delete', does: 'delete a conversation', panel: ['DELETE /api/harness/sessions/:id'], v1: ['DELETE /harness/sessions/{id}'] },
  { id: 'put-away', does: 'put a conversation or a mission away, or back', panel: ['POST /api/harness/sessions/:id/archive', 'POST /api/harness/missions/:id/archive', 'POST /api/archive/:kind/:id'],
    v1: ['POST /harness/sessions/{id}/archive', 'POST /harness/missions/{id}/archive'], note: 'projects and computers in the Archive are the machine\'s; a browser put away comes back by signing in again from it' },
  { id: 'archive-list', does: 'see what was put away', panel: ['GET /api/archive'], gap: 9, why: 'bringing back a conversation from a phone needs its id, and only the panel lists the put-away ones' },
  { id: 'turn-stop', does: 'stop a turn', panel: ['POST /api/harness/sessions/:id/stop'], v1: ['POST /harness/turns/{id}/cancel'] },
  { id: 'inbox-withdraw', does: 'see and withdraw a message waiting for a busy conversation', panel: ['GET /api/harness/sessions/:id/inbox', 'DELETE /api/harness/sessions/:id/inbox/:qid'],
    gap: 4, why: 'a phone gets 202 queued for a working conversation and cannot take back what it sent before it is read' },
  { id: 'conversation-settings', does: 'rename a conversation or change its mode (Agent, Plan, Ask, Debug)', panel: ['POST /api/harness/sessions/:id/settings'],
    gap: 6, why: 'switching to Ask or Plan before a risky request; its approval switch inside stays a host\'s' },
  { id: 'conversation-compact', does: 'fold a conversation\'s earlier messages into its summary now', panel: ['POST /api/harness/sessions/:id/compact'],
    v1: ['POST /harness/messages'], note: 'a device sends /compact as the message (harness/slash.js); /loop and /skill likewise' },
  { id: 'conversation-model', does: 'choose a conversation\'s model', panel: ['GET /api/harness/sessions/:id/model', 'POST /api/harness/sessions/:id/model'],
    gap: 7, why: 'a quicker or stronger model for one conversation, from the device it is held on' },
  { id: 'plan-decide', does: 'approve or reject a proposed plan', panel: ['POST /api/harness/sessions/:id/plan'],
    gap: 1, why: 'the plan reaches the phone as a document, and the work waits on a decision only the panel can give' },
  { id: 'attach', does: 'attach a file or a picture', panel: ['POST /api/attachments'], v1: ['POST /media'], note: 'then named on /harness/messages as mediaIds' },
  { id: 'speech', does: 'hear an answer in the hive\'s voice, and turn a recording into words', panel: ['POST /api/chat/synthesize', 'POST /api/chat/transcribe'],
    gap: 3, why: 'a voice note or a spoken answer outside a live call (D1 left it: speech with the device\'s voice)' },
  { id: 'call', does: 'talk in a live call', panel: ['POST /api/chat/heard', 'POST /api/chat/call-event'], v1: ['GET /call', 'GET /realtime'],
    note: 'in a device\'s call the hub\'s engine cuts the answer to what was heard itself' },

  // ── What the agents are doing ──
  { id: 'mission-stop', does: 'stop a specialist\'s mission', panel: ['POST /api/harness/missions/:id/stop'], v1: ['POST /harness/missions/{id}/stop'] },
  { id: 'mission-send', does: 'send a specialist an errand', panel: ['POST /api/harness/missions'],
    gap: 5, why: 'choosing who does a job without asking the Orchestrator to pass it on' },
  { id: 'missions-read', does: 'see the missions', panel: ['GET /api/harness/missions'], v1: ['GET /harness/missions'] },
  { id: 'missions-tidy', does: 'put finished missions away at once, or keep one out of the tidy-up', panel: ['POST /api/harness/missions/tidy', 'POST /api/harness/missions/:id/pin'],
    gap: 19, why: 'a phone clears one mission at a time (archive); "put away finished" and 📌 keep are the panel\'s' },
  { id: 'teams', does: 'stop a team, keep it going, or put it away', panel: ['GET /api/harness/missions/teams', 'GET /api/harness/missions/teams/:id',
    'POST /api/harness/missions/teams/:id/stop', 'POST /api/harness/missions/teams/:id/keep-going', 'POST /api/harness/missions/teams/:id/archive'],
    gap: 20, why: 'a device hears agent.team and draws the board, and stops one task\'s mission (POST /harness/missions/{id}/stop); stopping the whole team or keeping it going is the panel\'s' },
  { id: 'work-decide', does: 'restart or drop work a person stopped', panel: ['POST /api/harness/work/:id/restart', 'POST /api/harness/work/:id/drop'],
    v1: ['POST /harness/work/{id}/restart', 'POST /harness/work/{id}/drop'] },
  { id: 'working', does: 'see what works on its own', panel: ['GET /api/harness/working'], v1: ['GET /harness/working'] },
  { id: 'seen', does: 'mark a finished result seen', panel: ['POST /api/harness/seen/:id'], v1: ['POST /harness/missions/{id}/seen'] },
  { id: 'decisions', does: 'see everything waiting for my decision', panel: ['GET /api/decisions'], v1: ['GET /decisions'] },
  { id: 'approve', does: 'answer an approval', panel: ['POST /api/harness/approvals/:id'], v1: ['POST /prompts/{id}/select'],
    note: 'asked on the device that started the turn, or one whose person holds host (askAnywhere)' },
  { id: 'answer', does: 'answer the agent\'s question', panel: ['POST /api/harness/questions/:id', 'GET /api/harness/questions'], v1: ['GET /prompts', 'POST /prompts/{id}/select'] },
  { id: 'proposal-decide', does: 'accept or decline a settings proposal', panel: ['POST /api/harness/proposals/:id/apply', 'POST /api/harness/proposals/:id/reject'],
    gap: 2, ask: true, why: 'the proposal is read on the phone (/harness/memory) and waits for the panel; a device applying a setting is a rule to change, not a route to add' },
  { id: 'spent', does: 'see what was spent', panel: ['GET /api/harness/usage'], v1: ['GET /harness/usage'] },
  { id: 'spending', does: 'set a money budget and decide spending permissions', panel: ['GET /api/spending', 'POST /api/spending/*', 'DELETE /api/spending/permissions/:id'],
    only: 'budgets and spending permissions change only with the password, at the panel (CONSTITUTION S12, S14); a device opens /d/<id>/ for them' },
  { id: 'canvas', does: 'see and remove the pages the agent made', panel: ['GET /api/harness/canvases', 'DELETE /api/harness/canvases/:id'],
    gap: 13, why: 'a page the agent made for a person is shown on the panel only' },

  // ── What a person keeps ──
  { id: 'recipes-run', does: 'list and run recipes', panel: ['GET /api/recipes', 'POST /api/recipes/:id/run'], v1: ['GET /recipes', 'POST /recipes/{id}/run'] },
  { id: 'recipe-save', does: 'save what worked as a recipe', panel: ['POST /api/recipes', 'POST /api/recipes/from-session'],
    gap: 8, why: '"keep that" right after a turn worked, from the device it ran on' },
  { id: 'recipe-govern', does: 'delete a shared recipe, or accept or discard its repair', panel: ['DELETE /api/recipes/:id', 'POST /api/recipes/:id/accept', 'POST /api/recipes/:id/discard'],
    only: 'the hive\'s shared recipes are a host\'s to change, at the panel' },
  { id: 'schedules-switch', does: 'see my schedules and switch one on or pause it', panel: ['GET /api/schedules', 'POST /api/schedules/:id/state'], v1: ['GET /schedules', 'POST /schedules/{id}/state'] },
  { id: 'schedules-manage', does: 'make, run now or delete a schedule', panel: ['POST /api/schedules', 'POST /api/schedules/:id/run', 'DELETE /api/schedules/:id'],
    gap: 10, why: 'a device switches schedules on and off but makes none of its own' },
  { id: 'memory-read', does: 'read what the agent remembers', panel: ['GET /api/harness/memory'], v1: ['GET /harness/memory'] },
  { id: 'memory-edit', does: 'correct, forget, lock or flag what the agent remembers, and edit its rules', panel: ['POST /api/harness/memory', 'DELETE /api/harness/memory/:key', 'POST /api/harness/memory/:key/flag',
    'POST /api/harness/memory/:key/lock', 'POST /api/harness/memory/rules', 'DELETE /api/harness/memory/rules', 'POST /api/harness/memory/rules/answer', 'POST /api/harness/memory/rules/undo', 'POST /api/harness/memory/rules/verify'],
    gap: 14, ask: true, why: 'the shared memory is a host\'s to write until per-person memory; harness:memory only reads' },
  { id: 'face', does: 'watch the face', panel: ['GET /api/face/stream'], v1: ['GET /face', 'GET /face/stream'] },
  { id: 'ambient', does: 'see my day', panel: ['GET /api/ambient'], v1: ['GET /ambient'] },
  { id: 'notices', does: 'see and dismiss the notices sent to me', panel: ['GET /api/notices', 'POST /api/notices/:id/seen'], v1: ['GET /events', 'POST /events/ack'], note: 'a device\'s notices are `alert` events, acknowledged on its event stream' },
  { id: 'home', does: 'see my home and switch a light, open a cover, set the heating', panel: ['GET /api/home', 'GET /api/home/camera/:entity', 'POST /api/home/call'],
    gap: 18, why: 'the lights and the heating from the phone in a pocket or the watch, drawn by the app; until then the Home page in its web view' },
  { id: 'home-hold', does: 'keep the Home page live while it is shown', panel: ['POST /api/home/hold'],
    only: 'a panel page holding the hub\'s connection to Home Assistant open; a device\'s own home will hear changes on its event stream' },

  // ── Meetings (meetings/) ──
  { id: 'meetings', does: 'see my meetings and join one', panel: ['GET /api/meetings', 'GET /api/meetings/:id'], v1: ['GET /meetings'],
    note: 'a device lists them with each link and opens the room in its web view (/meet/<id>); native call screens come later' },
  { id: 'meeting-schedule', does: 'call someone, schedule, change, confirm or cancel a meeting',
    panel: ['POST /api/meetings', 'PATCH /api/meetings/:id', 'POST /api/meetings/:id/cancel', 'POST /api/meetings/:id/confirm', 'POST /api/meetings/:id/end'],
    gap: 22, why: 'calling a colleague or moving a meeting from the phone without opening the panel page; until then the Meetings page in its web view' },
  { id: 'meeting-room', does: 'be in a meeting: voice, video, chat, share my screen, offer or take control', panel: ['POST /api/meetings/:id/*'],
    only: 'a room is WebRTC in a page: a device joins by opening its link in its web view (DocaDesk, DocaMobile); the native call screen, and control from a phone, are later work in each app' },
  { id: 'meeting-calendar', does: 'connect my own calendar for meetings', panel: ['POST /api/meetings/calendar/:provider/connect', 'DELETE /api/meetings/calendar'],
    only: 'an OAuth sign-in with Google or Microsoft happens in a browser, at the panel' },

  // ── This screen, these devices ──
  { id: 'screen-profile', does: 'set this device\'s notifications (asking, haptics, quiet hours)', panel: ['POST /api/screen/profile'], v1: ['PUT /devices/{id}/profile'] },
  { id: 'screen-settings', does: 'change this screen\'s look and voice', panel: ['POST /api/screen/settings'],
    gap: 12, why: 'an app reads its effective settings (GET /api/v1/settings/effective) but sets them only through the panel page in its web view (/d/<id>/)' },
  { id: 'screen-reload', does: 'reload my open pages (an admin: every screen)', panel: ['POST /api/screen/reload'],
    only: 'a page reloading itself; an app\'s web view hears it on the page\'s own live feed' },
  { id: 'screen-layout', does: 'change my panel layout', panel: ['POST /api/screen/layout', 'POST /api/screen/layout/undo'],
    only: 'how the panel\'s own pages are arranged on a screen; an app draws its own' },
  { id: 'presence', does: 'say I am looking', panel: ['POST /api/presence'], v1: ['GET /events'], note: 'a device\'s presence is its event stream' },
  { id: 'device-pair', does: 'pair a device or issue its token', panel: ['POST /api/devices/pair', 'POST /api/devices'], v1: ['POST /devices/pair/start', 'POST /devices'] },
  { id: 'device-revoke', does: 'revoke, rename or rotate a device, or change its scopes', panel: ['DELETE /api/devices/:id', 'PATCH /api/devices/:id', 'POST /api/devices/:id/rotate', 'POST /api/devices/:id/scopes'],
    v1: ['DELETE /devices/{id}', 'POST /devices/{id}/rotate', 'PATCH /devices/{id}'] },
  { id: 'device-assign', does: 'give a device that belongs to nobody to a person', panel: ['POST /api/devices/:id/assign'],
    only: 'an admin\'s decision at the panel about devices paired before accounts; a device never re-owns another' },
  { id: 'device-approve', does: 'allow or refuse a new device that waits for approval', panel: ['POST /api/devices/:id/approve', 'POST /api/devices/:id/refuse'],
    v1: ['POST /devices/{id}/approve', 'POST /devices/{id}/refuse'] },
  { id: 'device-control', does: 'turn a device\'s family off or on, ask it again, or refresh it', panel: ['POST /api/devices/:id/control'],
    gap: 11, why: 'a person away from the desk revoking what a lost or misbehaving device lends' },
  { id: 'device-console', does: 'set what a device\'s console buttons do', panel: ['PUT /api/devices/:id/console', 'PUT /api/devices/:id/console/buttons'],
    gap: 16, why: 'set up on the watch it belongs to, rather than at the panel' },
  { id: 'device-files', does: 'browse and change a device\'s files', panel: ['POST /api/devices/:id/files/*'],
    only: 'the panel reaching into a device through the files family it lends; the device has its own files' },
  { id: 'sealed-use', does: 'use a sealed secret on a device', panel: [], v1: ['GET /mcp/self/seal'], note: 'keeping one is the owner\'s, at the panel (capability-map-host.js)' },
  { id: 'sealed-own', does: 'keep or forget a secret of my own for my devices', panel: ['POST /api/connectors/sealed/mine', 'DELETE /api/connectors/sealed/mine/:name'],
    only: 'a secret is typed in only where the password is asked again (CONSTITUTION S4, S14) — the panel, or a device opening /d/<id>/; never sent to a device to keep' },
  { id: 'channel-link', does: 'link or unlink a chat app (Telegram, Matrix, Slack, mail)', panel: ['POST /api/channels/:name/link', 'DELETE /api/channels/:name/chats/:chat'],
    gap: 15, why: 'the link code is made once; a linked chat is itself a device' },

  // ── The hive chat (people/) ──
  { id: 'people-chat', does: 'message the people of the hive: write, react, mark read, say I am typing', panel: ['POST /api/people/dm', 'POST /api/people/spaces/:id/messages',
    'POST /api/people/messages/:id/react', 'POST /api/people/spaces/:id/read', 'POST /api/people/spaces/:id/typing'],
    v1: ['POST /people/dm', 'POST /people/spaces/{id}/messages', 'POST /people/messages/{id}/react', 'POST /people/spaces/{id}/read', 'POST /people/spaces/{id}/typing'] },
  { id: 'people-manage', does: 'make a group or a channel, join, leave, add people, rename, pin, mute, edit or delete my message', panel: ['POST /api/people/spaces',
    'PATCH /api/people/spaces/:id', 'POST /api/people/spaces/:id/join', 'POST /api/people/spaces/:id/leave', 'POST /api/people/spaces/:id/members', 'POST /api/people/spaces/:id/mine',
    'PATCH /api/people/messages/:id', 'DELETE /api/people/messages/:id', 'POST /api/people/messages/:id/pin'],
    gap: 21, why: 'a phone writes and reacts in the spaces its person is in; making and arranging them is the panel\'s until a route is asked for' },
  { id: 'people-notify', does: 'choose where a hive-chat message reaches me: phone and watch, linked chats, each device, the words or only a notice', panel: ['POST /api/people/notify'],
    v1: ['POST /people/notify'] },
  { id: 'people-export', does: 'export every hive-chat conversation for compliance', panel: ['POST /api/people/export'],
    only: 'the owner\'s alone, with the password, written in the audit — the one way anyone reads conversations they are not in' },
  { id: 'org-place', does: 'place someone in the organisation tree (manager, team, title)', panel: ['PATCH /api/org/people/:id'],
    only: 'who reports to whom is people and levels: an admin\'s, or a team leader\'s for their own people, at the panel' },

  // ── A person's account ──
  { id: 'sign-in', does: 'sign in, out, or change my password', panel: ['POST /api/auth/login', 'POST /api/auth/logout', 'POST /api/auth/setup', 'POST /api/auth/step-up', 'POST /api/auth/password', 'DELETE /api/auth/sessions'],
    only: 'a person signing in to the panel; a device pairs instead (/devices)' },
  { id: 'grants', does: 'give or take back an exception (a grant)', panel: ['POST /api/auth/grants', 'DELETE /api/auth/grants/:id'],
    gap: 17, ask: true, why: 'an exception given from a phone; delegating is S11\'s, so the owner decides first' },
  { id: 'people', does: 'add people, set their levels, sign them out', panel: ['POST /api/auth/users', 'PATCH /api/auth/users/:id', 'POST /api/auth/users/:id/password', 'DELETE /api/auth/users/:id/sessions',
    'POST /api/auth/levels', 'PATCH /api/auth/levels/:id', 'DELETE /api/auth/levels/:id'], only: 'who may do what here: an admin\'s, at the panel with a recent sign-in' },
];

const CAPABILITIES = [...PERSON, ...HOST];
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** "METHOD /api/path" → whether it names this route; `exact` says whether it is a whole route or a /* family. */
function parse(pattern) {
  const [method, p] = pattern.split(' ');
  const family = p.endsWith('/*');
  const body = (family ? p.slice(0, -2) : p).split('/').map(s => s.startsWith(':') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/');
  return { method, exact: !family, re: new RegExp(`^${body}${family ? '/.+' : ''}$`) };
}

/** Which capabilities claim a route, the exact ones before the families (route params compared by position). */
function claims(method, routePath) {
  const sample = routePath.replace(/:[^/]+/g, 'x');
  const hits = { exact: [], family: [] };
  for (const c of CAPABILITIES) for (const pat of c.panel || []) {
    const { method: m, exact, re } = parse(pat);
    if (m === method && re.test(sample)) { (exact ? hits.exact : hits.family).push(c.id); break; }
  }
  return hits.exact.length ? hits.exact : hits.family;
}

/** The capabilities a device lacks, most missed first. */
const gaps = () => CAPABILITIES.filter(c => c.gap).sort((a, b) => a.gap - b.gap);

module.exports = { CAPABILITIES, MUTATING, parse, claims, gaps };
