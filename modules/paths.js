'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const HOME = os.homedir();

// Prefs are read here rather than through utils.js: this module is loaded before
// everything else, and utils.js needs it for PREFS_FILE.
// What outlives a version — prefs, certificates, data — lives in DOCA_HOME, set by
// run.sh. Unset (npm start, the tests), it is this checkout, as it always was.
const HOME_DIR   = process.env.DOCA_HOME || path.join(__dirname, '..');
const PREFS_FILE = process.env.DOCA_PREFS_FILE || path.join(HOME_DIR, '.dashboard-prefs.json');

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
  { key: 'SKILLS_DIR', label: 'OpenClaw skills directory', kind: 'dir', fallback: path.join(HOME, '.openclaw', 'workspace', 'skills'),
    note: 'One directory per installed skill' },
  { key: 'WORKSPACE_DIR', label: 'Workspace', kind: 'dir', fallback: path.join(HOME, '.openclaw', 'workspace'),
    note: 'Where the agent and the harness do their work' },
  { key: 'ATTACHMENTS_DIR', label: 'Attachments', kind: 'dir', fallback: path.join(HOME, '.openclaw', 'workspace', 'attachments'),
    note: 'Files attached to a conversation land here, and the agent reads them by path' },
  { key: 'AGENTS_DIR', label: 'Specialist agents', kind: 'dir', fallback: path.join(HOME, '.openclaw', 'workspace', 'agents'),
    note: 'One definition per specialist you made here (markdown; the shipped ones live in the code)' },
  { key: 'SETUP_DIR', label: 'Setup scripts', kind: 'dir', fallback: HOME,
    note: 'Directory the Setup panel reads its shell scripts from' },
  { key: 'SNAPSHOT_DIR', label: 'Snapshot storage', kind: 'dir', fallback: path.join(HOME, 'openclaw-snapshots'),
    note: 'Where created snapshots are kept' },
  { key: 'SNAPSHOT_SCRIPT', label: 'Snapshot script', kind: 'script', fallback: path.join(HOME, 'snapshot-agent.sh'),
    note: 'Optional — without it snapshots fall back to tar' },
  { key: 'RESTORE_SCRIPT', label: 'Restore script', kind: 'script', fallback: path.join(HOME, 'restore-agent.sh'),
    note: 'Optional — without it restores fall back to tar' },
  // Two settings that were environment-only (TODO.md "Settings that exist only as environment variables").
  { key: 'DOCA_FONT', label: 'Font for rendered images', kind: 'file', fallback: '', optional: true,
    note: 'A .ttf for the text in pictures the hub draws for watches; empty uses a font found on the system' },
  { key: 'OPENCLAW_GATEWAY_URL', label: 'OpenClaw gateway', kind: 'url', fallback: '', optional: true,
    note: 'Where the OpenClaw gateway listens, when it is not where its config says' },
];

/** Path overrides saved from Settings → Paths. */
function savedPaths() {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')).paths || {}; }
  catch { return {}; }
}

const ENV_AT_BOOT = {};
for (const { key } of SETTABLE) ENV_AT_BOOT[key] = process.env[key] || null;

// One rule for every setting the environment can also give (audit 2026-10-06, coh F15; TODO C3): the environment
// wins — it is what whoever launched DOCA (a unit, a container, .env) asked for — and the panel says so beside the
// field ("overridden by ENV"). Listen, the channels' tokens and mail already worked this way; paths used to let a
// saved value win. A saved path is written into process.env so every module below reads one value.
const SAVED = savedPaths();
for (const { key } of SETTABLE) {
  if (SAVED[key] && !ENV_AT_BOOT[key]) process.env[key] = SAVED[key];
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
// not would light up "restart DOCA to apply" for ever, with nothing to apply.
const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || path.join(HOME, '.openclaw', 'workspace', 'attachments');
const AGENTS_DIR      = process.env.AGENTS_DIR      || path.join(HOME, '.openclaw', 'workspace', 'agents');
const SNAPSHOT_SCRIPT = process.env.SNAPSHOT_SCRIPT || path.join(HOME, 'snapshot-agent.sh');
const RESTORE_SCRIPT  = process.env.RESTORE_SCRIPT  || path.join(HOME, 'restore-agent.sh');
const SNAPSHOT_DIR    = process.env.SNAPSHOT_DIR    || path.join(HOME, 'openclaw-snapshots');
const PORT            = process.env.PORT            || 4242;
// Canvases are served from here, never from PORT: see modules/canvas/origin.js.
const CANVAS_PORT     = Number(process.env.CANVAS_PORT) || Number(PORT) + 1;

// Self-signed certificate directory
const CERTS_DIR = path.join(HOME_DIR, '.certs');

// Backups: where they are written, and the one file that remembers their password.
const BACKUP_DIR           = process.env.DOCA_BACKUP_DIR || path.join(HOME_DIR, 'backups');
const BACKUP_PASSWORD_FILE = path.join(HOME_DIR, '.backup-password');
// Paths the agent's file tools refuse even inside the allowed roots.
// DOCA's own provider keys (modules/provider-keys.js), in the data folder so a
// backup carries them. The same formula as store.DATA_DIR, which paths cannot require.
const PROVIDER_KEYS_FILE = path.join(process.env.DOCA_DATA_DIR || path.join(HOME_DIR, '.doca'), 'keys', 'providers.json');
// A console's buttons hold commands a press runs on the host (modules/device-console.js):
// an agent that could write one would have a command run with nobody asked.
const DEVICE_CONSOLE_FILE = path.join(process.env.DOCA_DATA_DIR || path.join(HOME_DIR, '.doca'), 'device-console.json');
// A web search provider's key (modules/search): a secret, like the model providers'.
const SEARCH_KEYS_FILE = path.join(process.env.DOCA_DATA_DIR || path.join(HOME_DIR, '.doca'), 'keys', 'search.json');
// Connectors' OAuth apps and tokens (modules/connectors/vault.js): the keys to the owner's accounts.
const CONNECTOR_KEYS_FILE = path.join(process.env.DOCA_DATA_DIR || path.join(HOME_DIR, '.doca'), 'keys', 'connectors.json');
// Other hubs this one sends packs to (modules/packs/send.js): their addresses and the tokens they issued.
const HUB_KEYS_FILE = path.join(process.env.DOCA_DATA_DIR || path.join(HOME_DIR, '.doca'), 'keys', 'hubs.json');
// Logins the agents' computers sign in with (modules/logins.js): passwords the agent never sees.
const LOGIN_KEYS_FILE = path.join(process.env.DOCA_DATA_DIR || path.join(HOME_DIR, '.doca'), 'keys', 'logins.json');
const SERVICE_KEYS_FILE = path.join(process.env.DOCA_DATA_DIR || path.join(HOME_DIR, '.doca'), 'keys', 'services.json');   // keys for services (service-keys.js)
const API_SERVICES_FILE = path.join(process.env.DOCA_DATA_DIR || path.join(HOME_DIR, '.doca'), 'keys', 'api-services.json');   // what each service does (api-services/): beside its key, in the protected keys folder
const HF_KEYS_FILE = path.join(process.env.DOCA_DATA_DIR || path.join(HOME_DIR, '.doca'), 'keys', 'huggingface.json');   // the Hugging Face token (hf-token.js)
const VNC_KEYS_FILE = path.join(process.env.DOCA_DATA_DIR || path.join(HOME_DIR, '.doca'), 'keys', 'vnc.json');   // VNC targets and their passwords (vnc-targets/)
// The key DOCA's own Android apps are signed with when the hub builds them (modules/client-apps): an update installs only
// over an app signed with the same key, so every machine that builds them signs with this one.
const ANDROID_SIGNING_STORE = path.join(process.env.DOCA_DATA_DIR || path.join(HOME_DIR, '.doca'), 'keys', 'android-signing.keystore');
const ANDROID_SIGNING_FILE = path.join(process.env.DOCA_DATA_DIR || path.join(HOME_DIR, '.doca'), 'keys', 'android-signing.json');
// The keys folder as a whole too: what is kept there beside a key (a replaced signing key, android-signing.previous/)
// is as secret as the key, and a list of files cannot name what has not been written yet.
const PROTECTED_DIRS = [path.dirname(ANDROID_SIGNING_STORE)];
const PROTECTED_FILES = [BACKUP_PASSWORD_FILE, PROVIDER_KEYS_FILE, DEVICE_CONSOLE_FILE, SEARCH_KEYS_FILE, CONNECTOR_KEYS_FILE, HUB_KEYS_FILE, LOGIN_KEYS_FILE, SERVICE_KEYS_FILE, HF_KEYS_FILE, VNC_KEYS_FILE, ANDROID_SIGNING_STORE, ANDROID_SIGNING_FILE];

// Setup scripts the UI may read/write/run — the Setup panel's list, and the
// whole of it.
const ALLOWED_SCRIPTS = ['setup-openclaw.sh', 'setup-phase2.sh', 'snapshot-agent.sh', 'restore-agent.sh'];

// Those same four files as the Config tab wants them: the id its Scripts group
// draws the row under, and the path that row opens. CONFIG_REGISTRY is built
// from this rather than having them typed out a second time, because they were
// typed out twice and drifted — setup-phase2.sh sat in the Setup panel and in
// no Config row at all, so the two panels disagreed about which scripts exist.
// Keyed by file name, so the mapping to ALLOWED_SCRIPTS is the keys themselves
// and test/paths.test.js fails if the two lists ever part company again.
//
// The two setup scripts live in SETUP_DIR, which is where the Setup panel reads
// and runs them. The two agent scripts need not: the snapshot feature runs the
// file at SNAPSHOT_SCRIPT/RESTORE_SCRIPT, which are settable paths and may well
// be somewhere else, so those rows follow them rather than SETUP_DIR.
const SCRIPT_CONFIG = {
  'setup-openclaw.sh': { id: 'setup',    path: path.join(SETUP_DIR, 'setup-openclaw.sh') },
  'setup-phase2.sh':   { id: 'phase2',   path: path.join(SETUP_DIR, 'setup-phase2.sh') },
  'snapshot-agent.sh': { id: 'snapshot', path: SNAPSHOT_SCRIPT },
  'restore-agent.sh':  { id: 'restore',  path: RESTORE_SCRIPT },
};

// Multi-file config registry — editable config files surfaced in the UI. The
// script rows come from SCRIPT_CONFIG, so the Config tab lists exactly what the
// Setup panel lists.
const CONFIG_REGISTRY = {
  openclaw:          CONFIG_PATH,
  soul:              path.join(HOME, '.openclaw', 'SOUL.md'),
  compose:           path.join(COMPOSE_DIR, 'docker-compose.yml'),
  aider:             path.join(HOME, '.aider.conf.yml'),
  env:               path.join(COMPOSE_DIR, '.env'),
  'modelfile-qwen':  path.join(HOME, '.ollama', 'Modelfile.qwen-coder-gpu'),
  'modelfile-qwen3': path.join(HOME, '.ollama', 'Modelfile.qwen3'),
  ...Object.fromEntries(Object.values(SCRIPT_CONFIG).map(s => [s.id, s.path])),
};

// File manager — directories the browser and the agent's file tools may open. Per OS (hive.md §7, found by the
// first CI run on Windows and macOS, 2026-10-04): the list was Linux's (/media, /mnt, /tmp), so on Windows and
// macOS only the home folder was reachable and the system's own temp folder was refused. Other disks are where
// each OS mounts them: /media and /mnt, /Volumes, or a drive letter.
function defaultRoots(platform = process.platform) {
  const roots = [HOME];
  if (platform === 'win32') {
    const system = (process.env.SystemDrive || 'C:').toUpperCase().charAt(0);
    for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') if (l !== system && fs.existsSync(`${l}:\\`)) roots.push(`${l}:\\`);
  } else if (platform === 'darwin') roots.push('/Volumes', '/tmp');
  else roots.push('/media', '/mnt', '/tmp');
  roots.push(require('os').tmpdir());
  return [...new Set(roots)];
}
const FM_ALLOWED_ROOTS = defaultRoots();

const VALUES = {
  COMPOSE_DIR, CONFIG_PATH, SKILLS_DIR, WORKSPACE_DIR,
  SETUP_DIR, SNAPSHOT_DIR, SNAPSHOT_SCRIPT, RESTORE_SCRIPT, ATTACHMENTS_DIR, AGENTS_DIR,
  DOCA_FONT: process.env.DOCA_FONT || '', OPENCLAW_GATEWAY_URL: process.env.OPENCLAW_GATEWAY_URL || '',
};

/** What a path resolves to right now, including an override saved since boot.
 *  The constants above cannot see those, so anything acting on a path — and the
 *  rows the user is looking at — has to resolve it again. */
function currentValue(spec, saved = savedPaths()) {
  return ENV_AT_BOOT[spec.key] || saved[spec.key] || spec.fallback;
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
      source:  ENV_AT_BOOT[p.key] ? 'env' : saved[p.key] ? 'saved' : 'default',
      // Saved here and set in the environment: the environment's is used, and the row says so.
      overridden: !!(saved[p.key] && ENV_AT_BOOT[p.key]),
      // A URL is not on disk; an optional path left empty is not missing.
      exists:  p.kind === 'url' || (p.optional && !value) ? null : fs.existsSync(value),
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
  CANVAS_PORT,
  PREFS_FILE,
  CERTS_DIR,
  CONFIG_REGISTRY,
  FM_ALLOWED_ROOTS,
  HOME_DIR,
  BACKUP_DIR,
  BACKUP_PASSWORD_FILE,
  PROTECTED_FILES, PROTECTED_DIRS, CONNECTOR_KEYS_FILE, HUB_KEYS_FILE, LOGIN_KEYS_FILE, SERVICE_KEYS_FILE, API_SERVICES_FILE, HF_KEYS_FILE, VNC_KEYS_FILE, ANDROID_SIGNING_STORE, ANDROID_SIGNING_FILE,
  PROVIDER_KEYS_FILE,
  SEARCH_KEYS_FILE,
  ALLOWED_SCRIPTS,
  SCRIPT_CONFIG,
  SETTABLE,
  describe,
  create,
};
