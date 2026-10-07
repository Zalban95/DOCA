'use strict';

/**
 * Where DOCA keeps what, and whether it travels (TODO.md, "Split what travels
 * with a project from local operator state"; docs/design/state.md).
 *
 * Two homes: the prefs file (PREFS_FILE, one JSON object) and the data folder
 * (DOCA_DATA_DIR). Each top-level entry is one of:
 *   travels  meaningful on another machine and safe to hand on — how this DOCA
 *            looks and behaves, what it knows, who its agents are
 *   local    bound to this machine (paths, ports, binaries, spawnable commands)
 *            or a secret; carried by a backup of *this* machine, never by an
 *            export meant for another one
 *   mixed    both, key by key — named in `note`, so the split is written down
 *            where the next key will be added
 *
 * test/state-map.test.js fails when code reads a prefs key the schema does not
 * declare, so the split cannot drift silently.
 */
// The prefs file's keys are declared once, with their home and defaults, in settings-schema.js (TODO H2.1).
const PREFS = Object.fromEntries(Object.entries(require('./settings-schema').SCHEMA).map(([k, d]) => [k, { is: d.is, note: d.note }]));

const DATA = {
  'harness/memory.json':  { is: 'travels', note: 'what the agent knew before 2.111.0 (imported into doca.db once); memory-rules*.json stay files' },
  'harness/sessions':     { is: 'travels', note: 'conversations and their index before 2.111.0 (imported into doca.db once)' },
  'harness/usage':        { is: 'travels', note: 'the token ledger before 2.107.0 (imported into doca.db once)' },
  'doca.db':              { is: 'mixed',   note: 'the database (docs/design/database.md): usage, audit, conversations, memory, levels, grants and runs travel; accounts travel, their sessions are this install\'s' },
  'harness/proposals.json': { is: 'travels', note: 'settings proposals and their decisions' },
  'harness/tool-results': { is: 'local',   note: 'spilled tool output: a cache, rebuildable' },
  'harness/jobs':         { is: 'local',   note: 'background shell jobs of this machine' },
  'harness/contracts.json': { is: 'local', note: 'what this machine\'s providers were found to accept; relearned in one call anywhere else' },
  agents:                 { is: 'travels', note: 'specialist definitions and mission logs' },
  identity:               { is: 'travels', note: 'persona.md, human.md' },
  skills:                 { is: 'travels', note: 'skills made or imported here' },
  canvas:                 { is: 'travels', note: 'canvases' },
  attachments:            { is: 'travels', note: 'files attached to conversations' },
  media:                  { is: 'travels', note: 'media shown to devices' },
  auth:                   { is: 'mixed',   note: 'users and orgs travel; sign-in sessions are this install\'s (the audit log is in doca.db since 2.108.0)' },
  keys:                   { is: 'local',   note: 'provider API keys: secret' },
  'devices.json':         { is: 'local',   note: 'paired devices and their token hashes, bound to this host' },
  projects:               { is: 'local',   note: 'projects are folders of this machine' },
  checkpoints:            { is: 'local',   note: 'shadow git of this machine\'s project folders' },
  lsp:                    { is: 'local',   note: 'language servers installed here' },
  guards:                 { is: 'local',   note: 'the guard runtime and model files downloaded here' },
  mcp:                    { is: 'local',   note: 'MCP server state of this machine' },
  outbox:                 { is: 'local',   note: 'undelivered device messages' },
  'panel.pid':            { is: 'local',   note: 'the listening panel\'s pid and port (panel-running.js), so the token CLI can say whether a panel reads this folder; never backed up' },
  features:               { is: 'local',   note: 'how often each path was used here (features/usage.js): names and counts' },
};

module.exports = { PREFS, DATA };
