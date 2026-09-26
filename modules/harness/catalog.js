'use strict';

/**
 * Harness catalog — every agent runtime the panel can drive.
 *
 * Three kinds:
 *   builtin  the DOCA harness (modules/harness/agent.js), always present,
 *            the default on a fresh install
 *   stack    a Compose stack (OpenClaw) driven through COMPOSE_DIR
 *   cli      a terminal agent launched in an embedded PTY
 * plus `custom`, which is a cli harness the user typed in themselves.
 *
 * Everything the user can change lives in .dashboard-prefs.json under
 * `harness`: the default id, the custom list, and per-harness config.
 */
const path     = require('path');

const pkg = require('../../package.json');
const { COMPOSE_DIR } = require('../paths');
const { loadPrefs, savePrefs, streamCmd, detectBinary } = require('../utils');
const providers = require('./providers');

const BUILTIN_ID = 'doca';

/**
 * Known harnesses. `cmd` is what we look for on PATH and what the launcher
 * types into the terminal; `installCmd` is the vendor's documented installer.
 */
const KNOWN = [
  {
    id: BUILTIN_ID, label: 'DOCA Harness', vendor: 'DOCA', kind: 'builtin',
    note: 'Built in — structured memory, tool calling, any OpenAI-compatible model',
    url: 'https://protolab.tech',
  },
  {
    id: 'openclaw', label: 'OpenClaw', vendor: 'OpenClaw', kind: 'stack',
    note: 'Docker Compose agent stack — driven from Service Control below',
    url: 'https://github.com/openclaw/openclaw',
    // Falls back to "installed" so a stack that is not a git checkout still
    // reports as present instead of offering to clone over it.
    detect: { file: path.join(COMPOSE_DIR, 'docker-compose.yml'), gitRev: true },
    installCmd: `if [ -d "${COMPOSE_DIR}" ]; then cd "${COMPOSE_DIR}" && git pull; else git clone https://github.com/openclaw/openclaw.git "${COMPOSE_DIR}"; fi && cd "${COMPOSE_DIR}" && docker compose pull && docker compose up -d`,
  },
  {
    id: 'claude', label: 'Claude Code', vendor: 'Anthropic', kind: 'cli', cmd: 'claude',
    installCmd: 'npm install -g @anthropic-ai/claude-code',
    url: 'https://github.com/anthropics/claude-code',
    configPathHint: '~/.claude/settings.json',
  },
  {
    id: 'codex', label: 'Codex CLI', vendor: 'OpenAI', kind: 'cli', cmd: 'codex',
    installCmd: 'npm install -g @openai/codex',
    url: 'https://github.com/openai/codex',
    configPathHint: '~/.codex/config.toml',
  },
  {
    id: 'gemini', label: 'Gemini CLI', vendor: 'Google', kind: 'cli', cmd: 'gemini',
    installCmd: 'npm install -g @google/gemini-cli',
    url: 'https://github.com/google-gemini/gemini-cli',
    configPathHint: '~/.gemini/settings.json',
  },
  {
    id: 'copilot', label: 'Copilot CLI', vendor: 'GitHub', kind: 'cli', cmd: 'copilot',
    installCmd: 'npm install -g @github/copilot',
    url: 'https://github.com/features/copilot/cli',
  },
  {
    id: 'cursor-agent', label: 'Cursor CLI', vendor: 'Cursor', kind: 'cli', cmd: 'cursor-agent',
    installCmd: 'curl https://cursor.com/install -fsS | bash',
    url: 'https://cursor.com/cli',
  },
  {
    id: 'amp', label: 'Amp', vendor: 'Sourcegraph', kind: 'cli', cmd: 'amp',
    installCmd: 'curl -fsSL https://ampcode.com/install.sh | bash',
    url: 'https://ampcode.com',
  },
  {
    id: 'qwen', label: 'Qwen Code', vendor: 'Alibaba', kind: 'cli', cmd: 'qwen',
    installCmd: 'npm install -g @qwen-code/qwen-code',
    url: 'https://github.com/QwenLM/qwen-code',
  },
  {
    id: 'opencode', label: 'OpenCode', vendor: 'SST', kind: 'cli', cmd: 'opencode',
    installCmd: 'curl -fsSL https://opencode.ai/install | bash',
    url: 'https://github.com/sst/opencode',
    configPathHint: '~/.config/opencode/opencode.json',
  },
  {
    id: 'crush', label: 'Crush', vendor: 'Charm', kind: 'cli', cmd: 'crush',
    installCmd: 'npm install -g @charmland/crush',
    url: 'https://github.com/charmbracelet/crush',
  },
  {
    id: 'goose', label: 'Goose', vendor: 'Block', kind: 'cli', cmd: 'goose',
    installCmd: 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
    url: 'https://block.github.io/goose/docs/getting-started/installation/',
  },
  {
    id: 'continue', label: 'Continue', vendor: 'Continue', kind: 'cli', cmd: 'cn',
    installCmd: 'npm install -g @continuedev/cli',
    url: 'https://docs.continue.dev/cli/quickstart',
    configPathHint: '~/.continue/config.yaml',
  },
  {
    id: 'openhands', label: 'OpenHands', vendor: 'All Hands AI', kind: 'cli', cmd: 'openhands',
    installCmd: 'curl -fsSL https://install.openhands.dev/install.sh | sh',
    url: 'https://docs.openhands.dev/openhands/usage/cli/installation',
  },
  {
    id: 'aider', label: 'Aider', vendor: 'Aider', kind: 'cli', cmd: 'aider',
    installCmd: 'sudo pip install --break-system-packages aider-install && aider-install',
    url: 'https://aider.chat',
    configPathHint: '~/.aider.conf.yml',
  },
];

/* ── Prefs ────────────────────────────────────────────── */

/**
 * Read the `harness` block, seeding it on first run so a fresh install already
 * has a working default (the built-in harness) rather than nothing selected.
 * @returns {{ default: string, custom: object[], config: object }}
 */
function loadHarnessPrefs() {
  const prefs = loadPrefs();
  const h = prefs.harness;
  if (h && h.default) return { custom: [], config: {}, ...h };

  // Seed what is missing, and keep what is there: `harness` also holds the
  // approval mode and its allowlist, which used to be wiped by this first write
  // on an install where the mode was chosen before any harness was configured.
  const seeded = { ...(h || {}), default: BUILTIN_ID, custom: h?.custom || [],
    config: { [BUILTIN_ID]: providers.defaultParams(), ...(h?.config || {}) } };
  prefs.harness = seeded;
  try { savePrefs(prefs); } catch { /* read-only prefs: still serve the defaults */ }
  return seeded;
}

function saveHarnessPrefs(patch) {
  const prefs = loadPrefs();
  prefs.harness = { ...loadHarnessPrefs(), ...patch };
  savePrefs(prefs);
  return prefs.harness;
}

/** Every harness definition, known ones first, then the user's own. */
function all() {
  const custom = loadHarnessPrefs().custom.map(c => ({ ...c, kind: 'custom' }));
  return [...KNOWN, ...custom];
}

function get(id) {
  return all().find(h => h.id === id) || null;
}

/** The definition the built-in agent and the chat panel should use. */
function defaultId() {
  const { default: id } = loadHarnessPrefs();
  return get(id) ? id : BUILTIN_ID;
}

/* ── Detection ────────────────────────────────────────── */

/** Detect one harness. The built-in one is always there — it *is* the panel. */
async function detect(h) {
  if (h.kind === 'builtin') return { detected: true, version: `v${pkg.version}` };
  if (h.detect)             return require('../detect').detect(h.detect);   // declared: a file, a binary
  if (!h.cmd)               return { detected: false, version: null };
  const { detected, version } = await detectBinary(h.cmd);
  return { detected, version };
}

/**
 * Full state for the UI: every harness with detection, config and which one is
 * the default.
 */
async function list() {
  const hp   = loadHarnessPrefs();
  const defs = all();
  const rows = await Promise.all(defs.map(async h => ({
    ...h,
    ...(await detect(h)),
    canInstall: !!h.installCmd,
    needsSudo:  !!h.installCmd && h.installCmd.includes('sudo '),
    isDefault:  h.id === hp.default,
    config:     configFor(h.id),
  })));
  return { harnesses: rows, default: defaultId() };
}

/* ── Config (model params for the built-in one, launch/env for the rest) ── */

/** Per-harness config, merged over the defaults for its kind. */
function configFor(id) {
  const h = get(id);
  const saved = loadHarnessPrefs().config[id] || {};
  if (h?.kind === 'builtin') return { ...providers.defaultParams(), ...saved };
  return {
    launchCmd:  saved.launchCmd  || h?.cmd || '',
    configPath: saved.configPath || '',
    env:        saved.env        || '',
    model:      saved.model      || '',
  };
}

function saveConfig(id, patch) {
  if (!get(id)) throw Object.assign(new Error('Unknown harness'), { status: 404 });
  const hp = loadHarnessPrefs();
  const next = { ...hp.config, [id]: { ...configFor(id), ...patch } };
  saveHarnessPrefs({ config: next });
  return configFor(id);
}

/* ── Mutations ────────────────────────────────────────── */

function setDefault(id) {
  if (!get(id)) throw Object.assign(new Error('Unknown harness'), { status: 404 });
  saveHarnessPrefs({ default: id });
  return id;
}

/** Slug a label into an id that is safe in URLs and DOM ids. */
function slug(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/**
 * Add a harness the catalog has never heard of — anything with a command,
 * including one of your own.
 */
function addCustom({ label, cmd, installCmd, url, note, id }) {
  if (!label || !String(label).trim()) throw Object.assign(new Error('label required'), { status: 400 });
  if (!cmd   || !String(cmd).trim())   throw Object.assign(new Error('cmd required'),   { status: 400 });

  const newId = slug(id || label);
  if (!newId) throw Object.assign(new Error('label must contain a letter or digit'), { status: 400 });
  if (get(newId)) throw Object.assign(new Error(`A harness named "${newId}" already exists`), { status: 409 });

  const hp  = loadHarnessPrefs();
  const def = {
    id: newId, label: String(label).trim(), vendor: 'Custom', cmd: String(cmd).trim(),
    installCmd: installCmd ? String(installCmd).trim() : null,
    url:  url  ? String(url).trim()  : null,
    note: note ? String(note).trim() : 'Custom harness',
  };
  saveHarnessPrefs({ custom: [...hp.custom, def] });
  return { ...def, kind: 'custom' };
}

function removeCustom(id) {
  const hp = loadHarnessPrefs();
  if (!hp.custom.some(c => c.id === id))
    throw Object.assign(new Error('Not a custom harness'), { status: 404 });

  const config = { ...hp.config };
  delete config[id];
  saveHarnessPrefs({
    custom:  hp.custom.filter(c => c.id !== id),
    config,
    default: hp.default === id ? BUILTIN_ID : hp.default,
  });
}

/** Stream the vendor installer to the client. */
function install(res, id, password) {
  const h = get(id);
  if (!h)            return res.status(404).json({ error: 'Unknown harness' });
  if (!h.installCmd) return res.status(400).json({ error: `${h.label} has no installer — install it by hand` });
  streamCmd(res, h.installCmd, {
    label:    h.label,
    password: typeof password === 'string' && password.length > 0 ? password : undefined,
  });
}

module.exports = {
  BUILTIN_ID, KNOWN,
  all, get, list, detect, defaultId,
  loadHarnessPrefs, configFor, saveConfig, setDefault, addCustom, removeCustom, install,
};
