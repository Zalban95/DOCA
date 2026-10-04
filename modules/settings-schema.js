'use strict';

/**
 * Every setting, declared once (docs/design/hive.md §1; TODO H2.1). Each top-level key of the prefs file says:
 *
 *   is       travels | local | mixed — whether it means anything on another machine (state-map.js reads this)
 *   home     hive   — the whole DOCA: how its agents behave, what they may do
 *            device — one machine: `on: 'host'` for what is bound to the machine DOCA runs on (paths, ports,
 *                     binaries), `on: 'screen'` for how one screen shows the panel (theme, tabs, sidebar)
 *            person — one person's own (none yet: per-person memory and voice will be)
 *   note     what it is, in a phrase
 *   propose  where in it the agent may point a settings proposal, with the card's label — settings.SETTABLE is
 *            built from these, so a key is proposable by being declared so here, and nowhere else
 *   keys     its leaves that have a type and a default in code: `value()` reads the prefs file through them, so
 *            a default changed here reaches every install that never set one — nothing to migrate
 *
 * test/settings-schema.test.js fails when code reads a prefs key that is not declared here.
 */
const p = (label, note = '', extra = {}) => ({ label, note, ...extra });

const SCHEMA = {
  // ── How one screen shows the panel ──
  theme:            { is: 'travels', home: 'device', on: 'screen', note: 'colour theme', propose: p('Theme') },
  customTheme:      { is: 'travels', home: 'device', on: 'screen', note: 'a theme the person made', propose: p('Custom theme colours') },
  skin:             { is: 'travels', home: 'device', on: 'screen', note: 'the panel skin' },
  hiddenTabs:       { is: 'travels', home: 'device', on: 'screen', note: 'which tabs are hidden', propose: p('Navigation visibility') },
  codeExpanded:     { is: 'travels', home: 'device', on: 'screen', note: 'a UI fold state' },
  sidebarStats:     { is: 'travels', home: 'device', on: 'host', note: 'which stats the host collects for the sidebar (the collectors run here, for every screen)', propose: p('Sidebar stats', 'Which stats the sidebar shows') },
  sidebarSections:  { is: 'travels', home: 'device', on: 'screen', note: 'which sidebar sections are open', propose: p('Sidebar sections') },
  favorites:        { is: 'travels', home: 'device', on: 'screen', note: 'favourite config files, by registry id', propose: p('Config favourites') },
  hiddenBuiltins:   { is: 'travels', home: 'device', on: 'screen', note: 'built-in config entries hidden from the list', propose: p('Hidden built-ins') },

  // ── The hive: how its agents behave and what they may do ──
  branding:         { is: 'travels', home: 'hive', note: 'the name and look the panel wears' },
  updates:          { is: 'travels', home: 'hive', note: 'how updates are offered' },
  agents:           { is: 'travels', home: 'hive', note: 'whether specialists are switched on',
    propose: p('Specialist agents', 'Allow the orchestrator to dispatch specialists', { prefix: 'agents.enabled', exact: true }) },
  toolNotes:        { is: 'travels', home: 'hive', note: 'notes added to tool descriptions (fingerprinted per tool)',
    propose: p('Tool note', 'Added to the tool\'s description — what the agent reads when it picks the tool') },
  // Numbers only, and deliberately a different key from `mcpServers`, which holds commands this host spawns
  // and stays out of reach. settings.sectionFor matches a whole prefix, so one can never open the other.
  mcpSettings:      { is: 'travels', home: 'hive', note: 'MCP timeouts', propose: p('MCP timeouts', 'How long to wait for an MCP tool before giving up') },
  computers:        { is: 'travels', home: 'hive', note: 'limits on agents\' computers: how many run, when they stop and are removed',
    propose: p('Agents\' computers', 'How many run at once, when they stop and when they are removed'),
    keys: {
      maxRunning:      { type: 'integer', min: 0, default: 4, hint: 'How many agents\' computers may run at once.' },
      idleStopMinutes: { type: 'number', min: 0, default: 10, hint: 'Minutes after its mission ends that a computer stops (its files stay).' },
      retainHours:     { type: 'number', min: 0, default: 72, hint: 'Hours a stopped computer an agent made is kept before it is removed with its files; a pinned one is kept.' },
    } },
  usagePrices:      { is: 'travels', home: 'hive', note: 'the owner\'s price list for the usage window (harness/prices.js)' },
  providerContracts: { is: 'mixed', home: 'hive', note: 'the owner\'s corrections to what a provider accepts (harness/contracts.js): about a remote provider they travel, about a server on this machine they are local' },
  harness:          { is: 'mixed', home: 'hive', note: 'config (model, limits, fallback chain, prompts), the guards\' settings and approval mode travel (the guard model files are local, in the data folder); the always-allowed list names commands of this machine and is local. Provider keys are not here: they live in the data folder (keys/).',
    propose: [p('Harness parameters', 'Includes this agent\'s own model and behaviour', { prefix: 'harness.config' }),
      p('Default harness', 'Which runtime the chat panel talks to', { prefix: 'harness.default' })] },
  models:           { is: 'mixed', home: 'hive', note: 'preferences travel; models.hf.token is a secret and local, and runtime URLs name this machine',
    propose: p('Model manager', 'Ollama URL, download directories') },

  // ── The machine DOCA runs on ──
  paths:            { is: 'local', home: 'device', on: 'host', note: 'folders and URLs of this machine (paths.js SETTABLE)', propose: p('Managed paths', 'Applies after a restart of the panel') },
  fmFavorites:      { is: 'local', home: 'device', on: 'host', note: 'favourite folders: paths of this machine', propose: p('File manager favourites') },
  llamacpp:         { is: 'local', home: 'device', on: 'host', note: 'binary paths and server instances' },
  serviceSettings:  { is: 'local', home: 'device', on: 'host', note: 'ports and URLs of services on this machine', propose: p('Inference services', 'GPU assignment, ports, images') },
  voiceServices:    { is: 'local', home: 'device', on: 'host', note: 'speech services on this machine or the tailnet', propose: p('Voice services') },
  snapshotSettings: { is: 'local', home: 'device', on: 'host', note: 'where snapshots of this machine go', propose: p('Snapshot settings') },
  mcpServers:       { is: 'local', home: 'device', on: 'host', note: 'spawnable commands and URLs — never proposed, never exported' },
  dockerPresets:    { is: 'local', home: 'device', on: 'host', note: 'compose presets for this machine\'s Docker' },
  backup:           { is: 'local', home: 'device', on: 'host', note: 'the backup schedule of this machine' },
  network:          { is: 'local', home: 'device', on: 'host', note: 'how this machine listens' },
  vms:              { is: 'local', home: 'device', on: 'host', note: 'the libvirt connection URI of this machine', propose: p('Virtual machines', 'The libvirt connection URI') },
  channels:         { is: 'local', home: 'device', on: 'host', note: 'channel bots (Telegram): a token and a switch for this hub',
    keys: {
      'telegram.enabled': { type: 'boolean', default: false, hint: 'Whether the Telegram bot is polled.' },
      'telegram.pollSec': { type: 'number', min: 0, max: 50, default: 25, hint: 'How long one getUpdates call waits for a message.' },
    } },
};

/** settings.SETTABLE: where a proposal may point, in declaration order. */
function settable() {
  return Object.entries(SCHEMA).flatMap(([key, d]) => [].concat(d.propose || [])
    .map(x => ({ prefix: x.prefix || key, label: x.label, note: x.note || '', ...(x.exact ? { exact: true } : {}) })));
}

/** The declaration of a leaf (`computers.maxRunning`), or null. */
function leaf(dotted) {
  const [top, ...rest] = String(dotted).split('.');
  return SCHEMA[top]?.keys?.[rest.join('.')] || null;
}

function valid(spec, v) {
  if (v === undefined || v === null || v === '') return false;
  if (spec.type === 'boolean') return typeof v === 'boolean';
  if (spec.type === 'integer' || spec.type === 'number') {
    const n = Number(v);
    return Number.isFinite(n) && (spec.type !== 'integer' || Number.isInteger(n)) && (spec.min === undefined || n >= spec.min) && (spec.max === undefined || n <= spec.max);
  }
  if (spec.type === 'string') return typeof v === 'string';
  return true;
}

/** A declared leaf's value: what the prefs file holds when it is valid for the type, else the default. */
function value(dotted, prefs = require('./utils').loadPrefs()) {
  const spec = leaf(dotted);
  if (!spec) throw new Error(`${dotted} is not a declared setting (modules/settings-schema.js)`);
  const v = String(dotted).split('.').reduce((o, k) => (o == null ? undefined : o[k]), prefs);
  if (!valid(spec, v)) return spec.default;
  return spec.type === 'integer' || spec.type === 'number' ? Number(v) : v;
}

/** Every declared leaf with its value — what the agent's settings list and a device page draw. */
function leaves(prefs = require('./utils').loadPrefs()) {
  return Object.entries(SCHEMA).flatMap(([top, d]) => Object.entries(d.keys || {}).map(([k, spec]) => ({
    path: `${top}.${k}`, value: value(`${top}.${k}`, prefs), type: spec.type, default: spec.default, hint: spec.hint, home: d.home, on: d.on || null,
  })));
}

/** For the panel and clients: the declarations, without anything that could be a value. */
function describe() {
  return Object.fromEntries(Object.entries(SCHEMA).map(([k, d]) => [k, { is: d.is, home: d.home, on: d.on || null, note: d.note,
    proposable: !!d.propose, keys: d.keys ? Object.fromEntries(Object.entries(d.keys).map(([n, s]) => [n, { type: s.type, default: s.default, hint: s.hint }])) : undefined }]));
}

module.exports = { SCHEMA, settable, leaf, value, leaves, describe };
