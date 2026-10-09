'use strict';

/**
 * The licence's vocabulary (docs/design/licence.md). Every feature in modules/features/data names one `licence` code;
 * a code is a Keygen entitlement, and an edition is a list of codes — a Keygen policy whose licences carry those
 * entitlements. `core` is every hive's, licensed or not; `all` grants every code, today's and those a later release
 * adds (the owner's own hive, a tester's). A licence may also name one feature on its own, `feature.<id>`, to sell a
 * single feature without its group.
 */
const CODES = {
  core:     { label: 'Core', note: 'the agent and its structure: conversations, memory, skills, recipes, schedules, projects and files, models and MCP, approvals, logs, users and levels, backups and updates' },
  agents:   { label: 'Specialist agents', note: 'specialists on missions that work in parallel and report back' },
  voice:    { label: 'Voice and ambient', note: 'calls, the face, voice messages, speech services, the ambient screen' },
  devices:  { label: 'Devices and integrations', note: 'paired phones, watches, desk and browser clients (/api/v1), secrets used on a device, DOCA as an MCP, AG-UI and A2A agent' },
  channels: { label: 'Channels', note: 'Telegram, Matrix, Slack and mail' },
  machines: { label: 'Machines', note: 'agents\' own computers, virtual machines, VNC screens, Docker, Live' },
  home:     { label: 'Home', note: 'the home through Home Assistant: its page and smart-home control' },
  services: { label: 'Outside services', note: 'connected accounts (OAuth), keys for services, API services and the agent\'s drafts of them' },
  library:  { label: 'Pack library', note: 'packs sent between hubs, a registry, and offering what was learned to the project' },
  lab:      { label: 'Lab', note: 'developer mode, the experiments and evaluation sets: for the project\'s owners and testers (CONSTITUTION S5)' },
};
const ALL = 'all';

/** Editions are suggestions for the licence server's policies (doca-licensing reads them); `core` is implied. */
const EDITIONS = [
  { id: 'essentials', label: 'Essentials', codes: [], note: 'the general assistant on its own' },
  { id: 'personal',   label: 'Personal',   codes: ['voice', 'devices', 'channels', 'home', 'services'], note: 'a personal assistant across a person\'s devices and home' },
  { id: 'studio',     label: 'Studio',     codes: ['agents', 'machines', 'services', 'devices', 'library'], note: 'teams of agents with their own computers, for work' },
  { id: 'hosted',     label: 'Hosted',     codes: ['agents', 'voice', 'devices', 'channels', 'services'], note: 'a hive on a server with no GPU or hypervisor of its own: everything that needs neither' },
  { id: 'complete',   label: 'Complete',   codes: Object.keys(CODES).filter(c => c !== 'core' && c !== 'lab'), note: 'every code but the lab, as listed in this release' },
  { id: 'owner',      label: 'Owner',      codes: [ALL], note: 'everything, including what later releases add and the lab: the project\'s own hives' },
];

module.exports = { CODES, ALL, EDITIONS };
