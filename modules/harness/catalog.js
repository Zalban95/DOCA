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
    id: BUILTIN_ID, label: 'DOCA\'s own agent', vendor: 'DOCA', kind: 'builtin',   // a person's words: "what's a harness?" (self-test round two)
    note: 'Built in — it remembers what matters, uses tools, and works with any model you connect',
    get url() { return require('../branding').name('site'); },   // the vendor's site, as the logo (branding.js)
  },
  {
    id: 'openclaw', label: 'OpenClaw', vendor: 'OpenClaw', kind: 'stack',
    note: 'Docker Compose agent stack — started and updated in Settings → Harnesses → OpenClaw → Stack',
    url: 'https://github.com/openclaw/openclaw',
    // Falls back to "installed" so a stack that is not a git checkout still
    // reports as present instead of offering to clone over it.
    detect: { file: path.join(COMPOSE_DIR, 'docker-compose.yml'), gitRev: true },
    installCmd: `if [ -d "${COMPOSE_DIR}" ]; then cd "${COMPOSE_DIR}" && git pull; else git clone https://github.com/openclaw/openclaw.git "${COMPOSE_DIR}"; fi && cd "${COMPOSE_DIR}" && docker compose pull && docker compose up -d`,
  },
  {
    // A web app with its own Compose project and data (harness/opendots.js; docs/design/opendots-integration.md). Its
    // folder is a setting, so what it looks for and how it installs are read when the list is.
    id: 'opendots', label: 'OpenDots', vendor: 'CopilotKit', kind: 'stack', surface: 'web',
    note: 'Dots, Spaces and pages in its own web app — its own data and keys; Open goes to its page',
    url: 'https://github.com/CopilotKit/OpenDots',
    get detect() { return { file: path.join(require('./opendots').settings().dir, 'compose.yml'), gitRev: true }; },
    get installCmd() { return require('./opendots').installCmd(); },
  },
  {
    id: 'claude', label: 'Claude Code', vendor: 'Anthropic', kind: 'cli', cmd: 'claude',
    oneShot: ['-p', '{message}'],   // one question without a terminal (harness/one-shot.js)
    // A worker in a team in an agents' computer (harness-teams/): https://code.claude.com/docs/en/cli-reference and /headless
    // (-p, --permission-mode bypassPermissions, --output-format stream-json with --verbose, --model, `claude auth status`).
    team: { args: ['-p', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose', '{model}', '{task}'], model: ['--model', '{model}'],
      events: 'claude', key: { env: 'ANTHROPIC_API_KEY', host: 'api.anthropic.com' }, signedIn: ['auth', 'status'] },
    installCmd: 'npm install -g @anthropic-ai/claude-code',
    url: 'https://github.com/anthropics/claude-code',
    configPathHint: '~/.claude/settings.json',
  },
  {
    id: 'codex', label: 'Codex CLI', vendor: 'OpenAI', kind: 'cli', cmd: 'codex',
    oneShot: ['exec', '{message}'],   // one question without a terminal (harness/one-shot.js)
    // https://learn.chatgpt.com/docs/developer-commands?surface=cli (exec --dangerously-bypass-approvals-and-sandbox, --json,
    // -m) and https://learn.chatgpt.com/docs/non-interactive-mode (CODEX_API_KEY, the item.* JSON Lines events).
    team: { args: ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json', '{model}', '{task}'], model: ['-m', '{model}'],
      events: 'codex', key: { env: 'CODEX_API_KEY', host: 'api.openai.com' } },
    installCmd: 'npm install -g @openai/codex',
    url: 'https://github.com/openai/codex',
    configPathHint: '~/.codex/config.toml',
  },
  {
    // DeepSeek's own harness (MIT, developer preview; github.com/deepseek-ai/deepseek-harness, docs/cli-help.md):
    // `dsh headless "<task>"` answers one task and exits — the answer on stdout, diagnostics on stderr; settings in ~/.dsh.
    id: 'dsh', label: 'DeepSeek Harness', vendor: 'DeepSeek', kind: 'cli', cmd: 'dsh',
    oneShot: ['headless', '{message}'],   // one question without a terminal (harness/one-shot.js)
    // docs/cli-help.md and packages/bundle/headless/README.md of github.com/deepseek-ai/deepseek-harness: `headless --json`
    // (session, status, text, tool_call, tool_result, final). No model flag (the profile's agentDefaultModel) and no approval
    // flag: headless asks no one, so an ask fails closed (docs/subsystems/approval.md). DEEPSEEK_API_KEY (docs/config-catalog.md).
    team: { args: ['headless', '--json', '{task}'], model: null, events: 'dsh', key: { env: 'DEEPSEEK_API_KEY', host: 'api.deepseek.com' } },
    installCmd: 'npm install -g @deepseek-ai/dsh',
    url: 'https://github.com/deepseek-ai/deepseek-harness',
    configPathHint: '~/.dsh/profiles',
  },
  {
    id: 'gemini', label: 'Gemini CLI', vendor: 'Google', kind: 'cli', cmd: 'gemini',
    oneShot: ['-p', '{message}'],   // one question without a terminal (harness/one-shot.js)
    // github.com/google-gemini/gemini-cli docs/cli/cli-reference.md (--approval-mode yolo, -m, --output-format stream-json,
    // -p) and docs/cli/headless.md (init, message, tool_use, tool_result, error, result); GEMINI_API_KEY in its README.
    team: { args: ['--approval-mode', 'yolo', '--output-format', 'stream-json', '{model}', '-p', '{task}'], model: ['-m', '{model}'],
      events: 'gemini', key: { env: 'GEMINI_API_KEY', host: 'generativelanguage.googleapis.com' } },
    installCmd: 'npm install -g @google/gemini-cli',
    url: 'https://github.com/google-gemini/gemini-cli',
    configPathHint: '~/.gemini/settings.json',
  },
  {
    // mini-swe-agent (MIT; github.com/SWE-agent/mini-swe-agent, https://mini-swe-agent.com/latest/usage/mini/): about a
    // hundred lines of agent with bash as its only tool, a linear history and a trajectory file, models through litellm.
    // Checked against `mini --help` of v2.4.6: -t task, -y yolo (no confirmation), --exit-immediately, -l cost limit (0
    // off), -o trajectory, -m model; MSWEA_CONFIGURED skips its first-run wizard, MSWEA_COST_TRACKING=ignore_errors lets a
    // model litellm has no price for run. With -y it runs every command without asking, so `sandbox`: DOCA runs it only in
    // an agents' computer, as a team worker — never on the hub (one-shot.js refuses it; a person may still start it in
    // the Terminal, where it asks before each command).
    id: 'mini', label: 'mini-swe-agent', vendor: 'SWE-agent', kind: 'cli', cmd: 'mini', sandbox: true,
    get note() { return `A small bash-only coding agent: one task in a repository, a test to pass — run by ${require('../branding').name('product')} only in an agents' computer`; },
    // A worker in an agents' computer (harness-teams/): installed there with uv, its model DOCA's own through the model
    // relay (OPENAI_BASE_URL / OPENAI_API_KEY, litellm's `openai/<model>`; "default" is the relay's first), never a key.
    team: { args: ['-y', '--exit-immediately', '-l', '0', '{output}', '{model}', '-t', '{task}'], model: ['-m', 'openai/{model}'], defaultModel: 'default',
      output: ['-o', '{output}'], events: 'mini', uv: 'mini-swe-agent', relay: true, optIn: true,
      env: { MSWEA_CONFIGURED: 'true', MSWEA_COST_TRACKING: 'ignore_errors', MSWEA_SILENT_STARTUP: '1' },
      // When it fits — what the Orchestrator's routing table says (harness/coordinator.js), asked 2026-10-16.
      get when() { return 'a self-contained coding task in a git project with a command that shows it works (fix an issue, make a failing test pass, a small refactor), '
        + 'when several tries at once would help (count), the work should run on a smaller or local model, or a record of every command is wanted. '
        + `Not for work that needs ${require('../branding').name('product')}'s tools (devices, approvals, MCP, a browser, the person's files), long or several-repository work, or anything outside a computer: `
        + 'it runs every command without asking'; } },
    installCmd: 'uv tool install mini-swe-agent',
    url: 'https://mini-swe-agent.com',
    configPathHint: '~/.config/mini-swe-agent/.env',
  },
  {
    id: 'copilot', label: 'Copilot CLI', vendor: 'GitHub', kind: 'cli', cmd: 'copilot',
    oneShot: ['-p', '{message}'],   // one question without a terminal (harness/one-shot.js)
    installCmd: 'npm install -g @github/copilot',
    url: 'https://github.com/features/copilot/cli',
  },
  {
    id: 'cursor-agent', label: 'Cursor CLI', vendor: 'Cursor', kind: 'cli', cmd: 'cursor-agent',
    oneShot: ['-p', '{message}'],   // one question without a terminal (harness/one-shot.js)
    installCmd: 'curl https://cursor.com/install -fsS | bash',
    url: 'https://cursor.com/cli',
  },
  {
    id: 'amp', label: 'Amp', vendor: 'Sourcegraph', kind: 'cli', cmd: 'amp',
    oneShot: ['-x', '{message}'],   // one question without a terminal (harness/one-shot.js)
    installCmd: 'curl -fsSL https://ampcode.com/install.sh | bash',
    url: 'https://ampcode.com',
  },
  {
    id: 'qwen', label: 'Qwen Code', vendor: 'Alibaba', kind: 'cli', cmd: 'qwen',
    oneShot: ['-p', '{message}'],   // one question without a terminal (harness/one-shot.js)
    installCmd: 'npm install -g @qwen-code/qwen-code',
    url: 'https://github.com/QwenLM/qwen-code',
  },
  {
    id: 'opencode', label: 'OpenCode', vendor: 'SST', kind: 'cli', cmd: 'opencode',
    oneShot: ['run', '{message}'],   // one question without a terminal (harness/one-shot.js)
    installCmd: 'curl -fsSL https://opencode.ai/install | bash',
    url: 'https://github.com/sst/opencode',
    configPathHint: '~/.config/opencode/opencode.json',
  },
  {
    id: 'crush', label: 'Crush', vendor: 'Charm', kind: 'cli', cmd: 'crush',
    oneShot: ['run', '{message}'],   // one question without a terminal (harness/one-shot.js)
    installCmd: 'npm install -g @charmland/crush',
    url: 'https://github.com/charmbracelet/crush',
  },
  {
    id: 'goose', label: 'Goose', vendor: 'Block', kind: 'cli', cmd: 'goose',
    oneShot: ['run', '-t', '{message}'],   // one question without a terminal (harness/one-shot.js)
    installCmd: 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
    url: 'https://block.github.io/goose/docs/getting-started/installation/',
  },
  {
    id: 'continue', label: 'Continue', vendor: 'Continue', kind: 'cli', cmd: 'cn',
    oneShot: ['-p', '{message}'],   // one question without a terminal (harness/one-shot.js)
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
    config: { ...(h?.config || {}) } };   // no copy of the defaults: configFor() merges today's (old-defaults.js)
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
  return get(id) && !require('./harness-life').isDisabled(id) ? id : BUILTIN_ID;   // a switched-off one is not chosen
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
    disabled:   (hp.disabled || []).includes(h.id),   // switched off (harness-life.js)
    config:     configFor(h.id),
    ...(h.team ? { teamUse: require('../harness-teams/harnesses').mode(h) } : {}),   // its switch on a team: never | ask | free
    ...(h.kind === 'builtin' ? { foldWarning: require('./fold-check').warning(configFor(h.id)) } : {}),
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
  // The built-in harness keeps only what differs from today's defaults, so a later release's default still reaches
  // this install — a save used to freeze them all, the system prompt included (deep test B, C1; old-defaults.js).
  const merged = get(id).kind === 'builtin' ? require('./old-defaults').own({ ...(hp.config[id] || {}), ...patch }) : { ...configFor(id), ...patch };
  const next = { ...hp.config, [id]: merged };
  saveHarnessPrefs({ config: next });
  return configFor(id);
}

/* ── Mutations ────────────────────────────────────────── */

function setDefault(id) {
  if (!get(id)) throw Object.assign(new Error('Unknown harness'), { status: 404 });
  if (require('./harness-life').isDisabled(id)) throw require('../switch-off').off(`${get(id).label} is switched off: switch it on first.`, {
    what: get(id).label, route: `/api/harness/${encodeURIComponent(id)}/enabled`, body: { on: true }, page: 'controls', why: 'A harness switched off is kept but not offered or run; switched on, it can be the default again.' });
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
  loadHarnessPrefs, saveHarnessPrefs, configFor, saveConfig, setDefault, addCustom, removeCustom, install,
};
