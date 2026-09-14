'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const HOME = os.homedir();

// Prefs are read here rather than through utils.js: this module is loaded before
// everything else, and utils.js needs it for PREFS_FILE.
const PREFS_FILE = process.env.DOCA_PREFS_FILE || path.join(__dirname, '..', '.dashboard-prefs.json');

/**
 * The paths the dashboard needs, as Settings → Paths lists them. `kind` decides
 * what "Create" makes: a directory, a JSON file seeded with `{}`, or an
 * executable script seeded with a shebang.
 */
const SETTABLE = [
  { key: 'COMPOSE_DIR', label: 'Compose directory', kind: 'dir', fallback: path.join(HOME, 'openclaw'),
    note: 'Holds docker-compose.yml for the OpenClaw stack' },
  { key: 'CONFIG_PATH', label: 'OpenClaw config', kind: 'json', fallback: path.join(HOME, '.openclaw', 'openclaw.json'),
    note: 'Providers, API keys and gateway settings' },
  { key: 'SKILLS_DIR', label: 'Skills directory', kind: 'dir', fallback: path.join(HOME, '.openclaw', 'workspace', 'skills'),
    note: 'One directory per installed skill' },
  { key: 'WORKSPACE_DIR', label: 'Workspace', kind: 'dir', fallback: path.join(HOME, '.openclaw', 'workspace'),
    note: 'Where the agent and the harness do their work' },
  { key: 'ATTACHMENTS_DIR', label: 'Attachments', kind: 'dir', fallback: path.join(HOME, '.openclaw', 'workspace', 'attachments'),
    note: 'Files attached to a conversation land here, and the agent reads them by path' },
  { key: 'AGENTS_DIR', label: 'Specialist agents', kind: 'dir', fallback: path.join(HOME, '.openclaw', 'workspace', 'agents'),
    note: 'One JSON file per specialist the orchestrator can dispatch' },
  { key: 'SETUP_DIR', label: 'Setup scripts', kind: 'dir', fallback: HOME,
    note: 'Directory the Setup panel reads its shell scripts from' },
  { key: 'SNAPSHOT_DIR', label: 'Snapshot storage', kind: 'dir', fallback: path.join(HOME, 'openclaw-snapshots'),
    note: 'Where created snapshots are kept' },
  { key: 'SNAPSHOT_SCRIPT', label: 'Snapshot script', kind: 'script', fallback: path.join(HOME, 'snapshot-agent.sh'),
    note: 'Optional — without it snapshots fall back to tar' },
  { key: 'RESTORE_SCRIPT', label: 'Restore script', kind: 'script', fallback: path.join(HOME, 'restore-agent.sh'),
    note: 'Optional — without it restores fall back to tar' },
];

/** Path overrides saved from Settings → Paths. */
function savedPaths() {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')).paths || {}; }
  catch { return {}; }
}

const ENV_AT_BOOT = {};
for (const { key } of SETTABLE) ENV_AT_BOOT[key] = process.env[key] || null;

// A path saved in the dashboard beats the environment: it was set later, on
// purpose, and can be cleared from the same screen. Writing it into process.env
// means every module below reads one value without knowing prefs exist.
const SAVED = savedPaths();
for (const { key } of SETTABLE) {
  if (SAVED[key]) process.env[key] = SAVED[key];
}

// All paths are env-overridable; defaults use os.homedir() for portability.
const COMPOSE_DIR     = process.env.COMPOSE_DIR     || path.join(HOME, 'openclaw');
const CONFIG_PATH     = process.env.CONFIG_PATH     || path.join(HOME, '.openclaw', 'openclaw.json');
const SKILLS_DIR      = process.env.SKILLS_DIR      || path.join(HOME, '.openclaw', 'workspace', 'skills');
const WORKSPACE_DIR   = process.env.WORKSPACE_DIR   || path.join(HOME, '.openclaw', 'workspace');
const SETUP_DIR       = process.env.SETUP_DIR       || HOME;
// Same literal as the SETTABLE fallback above, not path.join(WORKSPACE_DIR, …):
// describe() compares this constant against the row's value to decide whether a
// path was saved since boot, so a constant that follows an override the row does
// not would light up "restart to apply" for ever, with nothing to apply.
const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || path.join(HOME, '.openclaw', 'workspace', 'attachments');
const AGENTS_DIR      = process.env.AGENTS_DIR      || path.join(HOME, '.openclaw', 'workspace', 'agents');
const SNAPSHOT_SCRIPT = process.env.SNAPSHOT_SCRIPT || path.join(HOME, 'snapshot-agent.sh');
const RESTORE_SCRIPT  = process.env.RESTORE_SCRIPT  || path.join(HOME, 'restore-agent.sh');
const SNAPSHOT_DIR    = process.env.SNAPSHOT_DIR    || path.join(HOME, 'openclaw-snapshots');
const PORT            = process.env.PORT            || 4242;

// Self-signed certificate directory
const CERTS_DIR = path.join(__dirname, '..', '.certs');

// Multi-file config registry — editable config files surfaced in the UI
const CONFIG_REGISTRY = {
  openclaw:          CONFIG_PATH,
  soul:              path.join(HOME, '.openclaw', 'SOUL.md'),
  compose:           path.join(COMPOSE_DIR, 'docker-compose.yml'),
  aider:             path.join(HOME, '.aider.conf.yml'),
  env:               path.join(COMPOSE_DIR, '.env'),
  'modelfile-qwen':  path.join(HOME, '.ollama', 'Modelfile.qwen-coder-gpu'),
  'modelfile-qwen3': path.join(HOME, '.ollama', 'Modelfile.qwen3'),
  setup:             path.join(SETUP_DIR, 'setup-openclaw.sh'),
  snapshot:          SNAPSHOT_SCRIPT,
  restore:           RESTORE_SCRIPT,
};

// File manager — directories the browser is allowed to access
const FM_ALLOWED_ROOTS = [
  HOME,
  '/media',
  '/mnt',
  '/tmp',
];

// Setup scripts the UI may read/write/run
const ALLOWED_SCRIPTS = ['setup-openclaw.sh', 'setup-phase2.sh', 'snapshot-agent.sh', 'restore-agent.sh'];

const VALUES = {
  COMPOSE_DIR, CONFIG_PATH, SKILLS_DIR, WORKSPACE_DIR,
  SETUP_DIR, SNAPSHOT_DIR, SNAPSHOT_SCRIPT, RESTORE_SCRIPT, ATTACHMENTS_DIR, AGENTS_DIR,
};

/** What a path resolves to right now, including an override saved since boot.
 *  The constants above cannot see those, so anything acting on a path — and the
 *  rows the user is looking at — has to resolve it again. */
function currentValue(spec, saved = savedPaths()) {
  return saved[spec.key] || ENV_AT_BOOT[spec.key] || spec.fallback;
}

/** Every settable path with its effective value, where that value came from,
 *  and whether it is actually there — the rows Settings → Paths renders. */
function describe() {
  const saved = savedPaths();
  return SETTABLE.map(p => {
    const value = currentValue(p, saved);
    return {
      ...p,
      value,
      // What this process is really using. It only differs when a path was saved
      // after boot, which is exactly when the user needs to be told to restart.
      active:  VALUES[p.key],
      pending: value !== VALUES[p.key],
      source:  saved[p.key] ? 'saved' : ENV_AT_BOOT[p.key] ? 'env' : 'default',
      exists:  fs.existsSync(value),
    };
  });
}

/** Create a settable path that is not there yet. */
function create(key) {
  const spec = SETTABLE.find(p => p.key === key);
  if (!spec) throw Object.assign(new Error(`Unknown path: ${key}`), { status: 404 });

  const target = currentValue(spec);
  if (fs.existsSync(target)) return { created: false, path: target };

  if (spec.kind === 'dir') {
    fs.mkdirSync(target, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (spec.kind === 'json') fs.writeFileSync(target, '{}\n', 'utf8');
    else { fs.writeFileSync(target, '#!/usr/bin/env bash\n', 'utf8'); fs.chmodSync(target, 0o755); }
  }
  return { created: true, path: target };
}

module.exports = {
  HOME,
  COMPOSE_DIR,
  CONFIG_PATH,
  SKILLS_DIR,
  WORKSPACE_DIR,
  ATTACHMENTS_DIR,
  AGENTS_DIR,
  SETUP_DIR,
  SNAPSHOT_SCRIPT,
  RESTORE_SCRIPT,
  SNAPSHOT_DIR,
  PORT,
  PREFS_FILE,
  CERTS_DIR,
  CONFIG_REGISTRY,
  FM_ALLOWED_ROOTS,
  ALLOWED_SCRIPTS,
  SETTABLE,
  describe,
  create,
};
