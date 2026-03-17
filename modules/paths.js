'use strict';

const path = require('path');
const os   = require('os');

const HOME = os.homedir();

// All paths are env-overridable; defaults use os.homedir() for portability.
const COMPOSE_DIR     = process.env.COMPOSE_DIR     || path.join(HOME, 'openclaw');
const CONFIG_PATH     = process.env.CONFIG_PATH     || path.join(HOME, '.openclaw', 'openclaw.json');
const SKILLS_DIR      = process.env.SKILLS_DIR      || path.join(HOME, '.openclaw', 'workspace', 'skills');
const WORKSPACE_DIR   = process.env.WORKSPACE_DIR   || path.join(HOME, '.openclaw', 'workspace');
const SETUP_DIR       = process.env.SETUP_DIR       || HOME;
const SNAPSHOT_SCRIPT = process.env.SNAPSHOT_SCRIPT || path.join(HOME, 'snapshot-agent.sh');
const RESTORE_SCRIPT  = process.env.RESTORE_SCRIPT  || path.join(HOME, 'restore-agent.sh');
const SNAPSHOT_DIR    = process.env.SNAPSHOT_DIR    || path.join(HOME, 'openclaw-snapshots');
const PORT            = process.env.PORT            || 4242;
const HTTPS_PORT      = process.env.HTTPS_PORT      || 4243;

// Prefs stored next to the server entry point
const PREFS_FILE = path.join(__dirname, '..', '.dashboard-prefs.json');

// Self-signed certificate directory
const CERTS_DIR = path.join(__dirname, '..', '.certs');

// Multi-file config registry — editable config files surfaced in the UI
const CONFIG_REGISTRY = {
  openclaw:          CONFIG_PATH,
  soul:              path.join(HOME, '.openclaw', 'SOUL.md'),
  compose:           path.join(HOME, 'openclaw', 'docker-compose.yml'),
  aider:             path.join(HOME, '.aider.conf.yml'),
  env:               path.join(HOME, 'openclaw', '.env'),
  'modelfile-qwen':  path.join(HOME, '.ollama', 'Modelfile.qwen-coder-gpu'),
  'modelfile-qwen3': path.join(HOME, '.ollama', 'Modelfile.qwen3'),
  setup:             path.join(HOME, 'setup-openclaw.sh'),
  snapshot:          path.join(HOME, 'snapshot-agent.sh'),
  restore:           path.join(HOME, 'restore-agent.sh'),
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

module.exports = {
  HOME,
  COMPOSE_DIR,
  CONFIG_PATH,
  SKILLS_DIR,
  WORKSPACE_DIR,
  SETUP_DIR,
  SNAPSHOT_SCRIPT,
  RESTORE_SCRIPT,
  SNAPSHOT_DIR,
  PORT,
  HTTPS_PORT,
  PREFS_FILE,
  CERTS_DIR,
  CONFIG_REGISTRY,
  FM_ALLOWED_ROOTS,
  ALLOWED_SCRIPTS,
};
