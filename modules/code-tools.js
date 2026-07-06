'use strict';

const fs   = require('fs');

const { PREFS_FILE } = require('./paths');
const { loadPrefs, streamCmd, detectBinary } = require('./utils');

const CODE_TOOLS = [
  { id: 'claude', label: 'Claude Code', cmd: 'claude', installHint: 'npm install -g @anthropic-ai/claude-code', url: 'https://github.com/anthropics/claude-code' },
  { id: 'aider',  label: 'Aider',       cmd: 'aider',  installHint: 'sudo pip install --break-system-packages aider-install && aider-install', url: 'https://aider.chat' },
  { id: 'codex',  label: 'OpenAI Codex CLI', cmd: 'codex', installHint: 'npm install -g @openai/codex', url: 'https://github.com/openai/codex' },
  { id: 'gemini', label: 'Gemini CLI',  cmd: 'gemini', installHint: 'npm install -g @google/gemini-cli', url: 'https://github.com/google-gemini/gemini-cli' },
  { id: 'qwen',   label: 'Qwen Code',   cmd: 'qwen',   installHint: 'npm install -g @qwen-code/qwen-code', url: 'https://github.com/QwenLM/qwen-code' },
  { id: 'opencode', label: 'OpenCode',  cmd: 'opencode', installHint: 'curl -fsSL https://opencode.ai/install | bash', url: 'https://github.com/sst/opencode' },
  { id: 'crush',  label: 'Crush',       cmd: 'crush',  installHint: 'npm install -g @charmland/crush', url: 'https://github.com/charmbracelet/crush' },
  { id: 'cursor-agent', label: 'Cursor CLI', cmd: 'cursor-agent', installHint: 'curl https://cursor.com/install -fsS | bash', url: 'https://cursor.com/cli' },
  { id: 'goose',  label: 'Goose',       cmd: 'goose',  installHint: 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash', url: 'https://block.github.io/goose/docs/getting-started/installation/' },
];

/** GET /api/code/tools */
async function handleList(req, res) {
  const prefs    = loadPrefs();
  const expanded = prefs.codeExpanded || [];
  const cfgMap   = prefs.codeConfig   || {};

  const results = await Promise.all(CODE_TOOLS.map(async t => {
    const { detected, version } = await detectBinary(t.cmd);
    return {
      ...t,
      detected,
      version,
      pinned:     expanded.includes(t.id),
      configPath: cfgMap[t.id]?.configPath || '',
    };
  }));

  res.json({ tools: results, expanded });
}

/** POST /api/code/tools/pin */
function handlePin(req, res) {
  const { expanded } = req.body;
  if (!Array.isArray(expanded)) return res.status(400).json({ error: 'expanded must be array' });
  const prefs = loadPrefs();
  prefs.codeExpanded = expanded;
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/code/tools/:id/config */
function handleConfig(req, res) {
  const { id } = req.params;
  const { configPath } = req.body;
  try {
    const prefs = loadPrefs();
    if (!prefs.codeConfig) prefs.codeConfig = {};
    prefs.codeConfig[id] = { configPath: configPath || '' };
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/code/tools/:id/install */
function handleInstall(req, res) {
  const tool = CODE_TOOLS.find(t => t.id === req.params.id);
  if (!tool) return res.status(404).json({ error: 'Unknown tool' });

  const { password } = req.body || {};
  streamCmd(res, tool.installHint, {
    label:    tool.label,
    password: typeof password === 'string' && password.length > 0 ? password : undefined,
  });
}

module.exports = { CODE_TOOLS, handleList, handlePin, handleConfig, handleInstall };
