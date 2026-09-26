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
 * test/state-map.test.js fails when code reads a prefs key this map does not
 * classify, so the split cannot drift silently.
 */
const PREFS = {
  theme:            { is: 'travels', note: 'colour theme' },
  customTheme:      { is: 'travels', note: 'a theme the person made' },
  skin:             { is: 'travels', note: 'the panel skin' },
  branding:         { is: 'travels', note: 'the name and look the panel wears' },
  hiddenTabs:       { is: 'travels', note: 'which tabs are hidden' },
  codeExpanded:     { is: 'travels', note: 'a UI fold state' },
  sidebarStats:     { is: 'travels', note: 'which stats the sidebar shows' },
  sidebarSections:  { is: 'travels', note: 'which sidebar sections are open' },
  favorites:        { is: 'travels', note: 'favourite config files, by registry id' },
  hiddenBuiltins:   { is: 'travels', note: 'built-in config entries hidden from the list' },
  updates:          { is: 'travels', note: 'how updates are offered' },
  agents:           { is: 'travels', note: 'whether specialists are switched on' },
  toolNotes:        { is: 'travels', note: 'notes added to tool descriptions (fingerprinted per tool)' },
  mcpSettings:      { is: 'travels', note: 'MCP timeouts' },
  harness:          { is: 'mixed',   note: 'config (model, limits, fallback chain, prompts), the guards\' settings and approval mode travel (the guard model files are local, in the data folder); the always-allowed list names commands of this machine and is local. Provider keys are not here: they live in the data folder (keys/).' },
  models:           { is: 'mixed',   note: 'preferences travel; models.hf.token is a secret and local, and runtime URLs name this machine' },
  paths:            { is: 'local',   note: 'folders and URLs of this machine (paths.js SETTABLE)' },
  fmFavorites:      { is: 'local',   note: 'favourite folders: paths of this machine' },
  llamacpp:         { is: 'local',   note: 'binary paths and server instances' },
  serviceSettings:  { is: 'local',   note: 'ports and URLs of services on this machine' },
  voiceServices:    { is: 'local',   note: 'speech services on this machine or the tailnet' },
  snapshotSettings: { is: 'local',   note: 'where snapshots of this machine go' },
  mcpServers:       { is: 'local',   note: 'spawnable commands and URLs — never proposed, never exported' },
  dockerPresets:    { is: 'local',   note: 'compose presets for this machine\'s Docker' },
  backup:           { is: 'local',   note: 'the backup schedule of this machine' },
  network:          { is: 'local',   note: 'how this machine listens' },
};

const DATA = {
  'harness/memory.json':  { is: 'travels', note: 'what the agent knows (with memory-rules*.json)' },
  'harness/sessions':     { is: 'travels', note: 'conversations and their index (sessions.json)' },
  'harness/usage':        { is: 'travels', note: 'the token ledger' },
  'harness/proposals.json': { is: 'travels', note: 'settings proposals and their decisions' },
  'harness/tool-results': { is: 'local',   note: 'spilled tool output: a cache, rebuildable' },
  'harness/jobs':         { is: 'local',   note: 'background shell jobs of this machine' },
  agents:                 { is: 'travels', note: 'specialist definitions and mission logs' },
  identity:               { is: 'travels', note: 'persona.md, human.md' },
  skills:                 { is: 'travels', note: 'skills made or imported here' },
  canvas:                 { is: 'travels', note: 'canvases' },
  attachments:            { is: 'travels', note: 'files attached to conversations' },
  media:                  { is: 'travels', note: 'media shown to devices' },
  auth:                   { is: 'mixed',   note: 'users and orgs travel; sign-in sessions and the audit log are this install\'s' },
  keys:                   { is: 'local',   note: 'provider API keys: secret' },
  'devices.json':         { is: 'local',   note: 'paired devices and their token hashes, bound to this host' },
  projects:               { is: 'local',   note: 'projects are folders of this machine' },
  checkpoints:            { is: 'local',   note: 'shadow git of this machine\'s project folders' },
  lsp:                    { is: 'local',   note: 'language servers installed here' },
  guards:                 { is: 'local',   note: 'the guard runtime and model files downloaded here' },
  mcp:                    { is: 'local',   note: 'MCP server state of this machine' },
  outbox:                 { is: 'local',   note: 'undelivered device messages' },
};

module.exports = { PREFS, DATA };
