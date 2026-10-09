'use strict';

/**
 * The machine's own administration, as capabilities (capability-map.js has the shape and the person's own). Nearly all
 * of it is a host's at the panel, and a device that needs it opens the panel itself (/d/<id>/) in its web view — but
 * what the hub's command registry already runs (api-v1/commands.js: the stack, a container, a service, a llama.cpp
 * server, a skill, a snapshot, the panel's restart) is the same capability for a device, by POST /commands/{id}.
 */
const HOST = 'the machine\'s own administration: a host\'s, at the panel';
const SECRET = 'the owner\'s secrets, kept at the panel and never handed back';
const CMD = ['POST /commands/{id}'];
const row = (id, does, panel, more = {}) => ({ id, does, panel, ...(more.v1 ? {} : { only: HOST }), ...more });

module.exports = [
  // ── What the command registry also runs for a device ──
  row('stack', 'start, stop or restart the stack', ['POST /api/action'], { v1: CMD, note: 'compose.start / stop / restart' }),
  row('container', 'start, stop or restart a container', ['POST /api/docker/containers/:id/action'], { v1: CMD, note: 'docker.container.*' }),
  row('service', 'start or stop an inference service', ['POST /api/services/start', 'POST /api/services/stop'], { v1: CMD, note: 'services.start / stop' }),
  row('llamacpp-run', 'start, stop or restart a llama.cpp server', ['POST /api/models/llamacpp/start', 'POST /api/models/llamacpp/stop', 'POST /api/models/llamacpp/restart'], { v1: CMD, note: 'llamacpp.*' }),
  row('skill-toggle', 'switch a skill on or off', ['POST /api/skills/:name/toggle'], { v1: CMD, note: 'skills.toggle' }),
  row('snapshot', 'take a snapshot of the agent', ['POST /api/snapshots/create'], { v1: CMD, note: 'snapshots.create' }),
  row('restart', 'restart the panel', ['POST /api/restart'], { v1: CMD, note: 'panel.restart' }),

  // ── DOCA itself ──
  row('versions', 'update DOCA, switch version, start at boot', ['POST /api/update', 'POST /api/versions/use', 'POST /api/startup', 'POST /api/stack/update']),
  row('backups', 'make, schedule and restore backups', ['POST /api/backups/*', 'POST /api/backups', 'DELETE /api/backups/:name']),
  row('settings', 'change the hive\'s settings, paths and network', ['POST /api/prefs', 'POST /api/paths', 'POST /api/paths/create', 'POST /api/network', 'POST /api/settings/checkpoints/:id/restore',
    'POST /api/configs/:id', 'POST /api/config-favorites', 'POST /api/fm-favorites', 'POST /api/features/:id/hidden', 'POST /api/logs/keep']),
  row('licence', 'add, renew, check in or remove this hive\'s licence', ['POST /api/licence/file', 'POST /api/licence/key', 'POST /api/licence/check', 'DELETE /api/licence'],
    { only: 'which features this hive may run: the owner\'s, at the panel (license/)' }),
  row('developer', 'developer mode, experiments and who may release', ['POST /api/developer/releasing', 'POST /api/experiments/developer', 'POST /api/experiments/:id']),
  row('guided', 'set up this machine from the guided questions', ['POST /api/guided/*'], { only: 'setting up this machine (what it can bear, what to install, which keys to paste): the owner\'s, at the panel' }),
  row('sharing', 'offer what was learned to the project', ['POST /api/sharing', 'POST /api/sharing/:packId/share'], { only: 'the owner\'s answer and click (CONSTITUTION §0); a host\'s alone' }),
  row('packs', 'make, bring in, keep and send packs', ['POST /api/packs/*', 'DELETE /api/packs/hubs/:id', 'DELETE /api/packs/library/:id'],
    { only: 'making and bringing in packs is a host\'s; between hubs a pack arrives at POST /api/v1/packs' }),
  row('screens-show', 'send a page to another screen', ['POST /api/screens/:id/show']),
  row('clients-build', 'upload, build and sign DOCA\'s apps', ['POST /api/clients/apps/*', 'POST /api/clients/apps/signing'],
    { only: 'building on the hub is a host\'s; a device fetches the result at GET /api/v1/clients/android/{app}' }),

  // ── The machine ──
  row('files', 'change files on the hub', ['POST /api/files/*']),
  row('docker', 'pull, run and remove images and containers', ['POST /api/docker/images/pull', 'DELETE /api/docker/images/:id', 'POST /api/docker/presets', 'DELETE /api/docker/presets/:name', 'POST /api/docker/run']),
  row('vms', 'manage virtual machines', ['POST /api/vms/*', 'DELETE /api/vms/libvirt/:name/snapshots/:snap']),
  row('vnc', 'add, change and remove VNC screens', ['POST /api/machines/vnc', 'PUT /api/machines/vnc/:id', 'DELETE /api/machines/vnc/:id'],
    { only: 'another machine\'s address and the password the hub keeps for it: a host\'s, at the panel' }),
  row('services-settings', 'set up inference services, and when they stop and start by themselves', ['POST /api/services/settings', 'POST /api/services/life', 'POST /api/services/life/:kind/:id', 'POST /api/services/life/:kind/:id/adopt']),
  row('system-tools', 'install what this machine needs', ['POST /api/system/tools/install', 'POST /api/setup/scripts/:name']),
  row('snapshots', 'restore a snapshot and set where they go', ['POST /api/snapshots/restore', 'POST /api/snapshots/settings']),
  row('skills', 'install and remove skills', ['POST /api/skills/install', 'DELETE /api/skills/:name']),
  row('models', 'download, delete and configure models', ['POST /api/models/*', 'DELETE /api/models/llamacpp/:id']),
  row('mcp', 'add, start, stop and export MCP servers, and accept one a device offers', ['POST /api/mcp', 'POST /api/mcp/*', 'DELETE /api/mcp/:id', 'DELETE /api/mcp/drafts/:id'],
    { only: 'a server is a command spawned on this machine or an address it calls: a host\'s; a device offers its own at POST /api/v1/mcp/offer' }),
  row('computers', 'make, run, pin and remove the agents\' computers, and archive or delete containers no record names', ['POST /api/computers', 'POST /api/computers/*', 'DELETE /api/computers/:id', 'DELETE /api/computers/strays/:name']),
  row('system-one', 'set up, start and stop the System 1 model\'s service, and try a decision', ['POST /api/system-one/*'],
    { only: 'a process on this machine and an experiment of the hub\'s own; a device\'s turns already use it' }),
  row('wakeword', 'record, train and remove wake-word models', ['POST /api/wakeword/*', 'DELETE /api/wakeword/models/:name', 'DELETE /api/wakeword/samples/:word/:kind'],
    { only: 'training is the hub\'s; a device downloads the kept models at GET /api/v1/wakeword' }),
  row('watching', 'watch folders and the Workstream', ['POST /api/live/watch', 'POST /api/workstream/hold'],
    { only: 'watching this machine\'s folders; a device already hears turns, missions and work chats on GET /api/v1/events' }),

  // ── The owner's accounts and secrets ──
  row('keys', 'keep API keys for providers', ['POST /api/keys', 'POST /api/keys/add-provider', 'POST /api/keys/test-provider', 'DELETE /api/keys/:name'], { only: SECRET }),
  row('connectors', 'connect accounts, keep keys and API services, logins and sealed secrets', ['POST /api/connectors/:id', 'DELETE /api/connectors/:id', 'POST /api/connectors/:id/connect',
    'POST /api/connectors/keys/all', 'DELETE /api/connectors/keys/:name', 'POST /api/connectors/logins/all', 'DELETE /api/connectors/logins/:id', 'POST /api/connectors/sealed/all',
    'DELETE /api/connectors/sealed/:name', 'POST /api/connectors/drafts/:id/accept', 'DELETE /api/connectors/drafts/:id',
    'POST /api/connectors/services/find', 'POST /api/connectors/services/read', 'POST /api/connectors/services/all', 'POST /api/connectors/services/:name/try', 'DELETE /api/connectors/services/:name'], { only: SECRET }),
  row('channels', 'switch a chat app on and give it its token', ['POST /api/channels/telegram', 'POST /api/channels/matrix', 'POST /api/channels/slack', 'POST /api/channels/mail'], { only: SECRET }),

  // ── How the agents work ──
  row('harnesses', 'install, choose and configure harnesses', ['POST /api/harness/default', 'POST /api/harness/custom', 'DELETE /api/harness/custom/:id', 'POST /api/harness/:id/config',
    'POST /api/harness/:id/install', 'POST /api/harness/opendots/config', 'POST /api/harness/opendots/stack', 'DELETE /api/harness/contracts/:provider', 'POST /api/harness/usage/prices']),
  row('approval-mode', 'switch the approval mode, and forget an "always"', ['POST /api/harness/approval', 'DELETE /api/harness/approval/always/:key'],
    { only: 'the agent\'s leash is the owner\'s at the panel, with the password (a safety switch, CONSTITUTION S14); no device changes it — Full auto left the wrist in 2.281.0' }),
  row('installs', 'accept or decline an install the agent proposed', ['POST /api/harness/installs/:id/apply', 'POST /api/harness/installs/:id/reject'],
    { only: 'installing on this machine is a host\'s click (installs.js)' }),
  row('specialists', 'make, edit and switch on specialists, and the agents\' identity', ['POST /api/harness/agents', 'POST /api/harness/agents/enable', 'POST /api/harness/agents/:id',
    'DELETE /api/harness/agents/:id', 'POST /api/harness/agents/:id/promote', 'POST /api/harness/agent-import', 'POST /api/harness/identity']),
  row('harness-skills', 'write, import and adapt skills', ['POST /api/harness/skills', 'POST /api/harness/skills/draft', 'POST /api/harness/skills/import', 'POST /api/harness/skills/:name/adapt',
    'POST /api/harness/skills/:name/restore', 'POST /api/harness/skills/online/import', 'POST /api/harness/skills/:name/triggers/suggest'], { only: 'a skill is instructions the agents follow: a host\'s (learn.js)' }),
  row('guards', 'set up the guards that check the agents\' calls', ['POST /api/harness/guards', 'POST /api/harness/guards/*', 'DELETE /api/harness/guards/:id']),
  row('previews', 'show a port of this machine as a preview', ['POST /api/harness/previews']),
  row('tuning', 'set up search, retrieval, vision, the realtime model and assistant mode', ['POST /api/search/*', 'POST /api/retrieval', 'POST /api/retrieval/try', 'DELETE /api/retrieval/index',
    'POST /api/vision', 'POST /api/vision/try', 'POST /api/realtime', 'POST /api/assistant']),
  row('scout', 'run the model scout and decide its suggestions', ['POST /api/scout/*']),
  row('evals', 'write and run evaluation sets', ['POST /api/evals/*', 'PUT /api/evals/:id', 'DELETE /api/evals/:id'], { only: 'a run spends tokens and its results hold answers: a host\'s' }),

  // ── Projects: folders and git on this machine ──
  row('projects', 'make projects, their chats, pages and worktrees; edit, run and commit', ['POST /api/projects', 'POST /api/projects/*', 'DELETE /api/projects/:id', 'PATCH /api/projects/:id/checkpoints/:cp',
    'DELETE /api/projects/:id/checkpoints/:cp'], { only: 'a project is a folder on this machine and its git; its chats are conversations a device reaches at /api/v1/harness' }),
];
