'use strict';

const fs   = require('fs');
const os   = require('os');
const { exec, spawn } = require('child_process');

const { PREFS_FILE } = require('./paths');
const { sseHeaders, loadPrefs } = require('./utils');

const CODE_TOOLS = [
  { id: 'claude', label: 'Claude Code', cmd: 'claude', installHint: 'npm install -g @anthropic-ai/claude-code', url: 'https://github.com/anthropics/claude-code' },
  { id: 'aider',  label: 'Aider',       cmd: 'aider',  installHint: 'sudo pip install --break-system-packages aider-install && aider-install', url: 'https://aider.chat' },
  { id: 'codex',  label: 'OpenAI Codex CLI', cmd: 'codex', installHint: 'npm install -g @openai/codex', url: 'https://github.com/openai/codex' },
  { id: 'goose',  label: 'Goose',       cmd: 'goose',  installHint: 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash', url: 'https://block.github.io/goose/docs/getting-started/installation/' },
];

/** GET /api/code/tools */
async function handleList(req, res) {
  const prefs    = loadPrefs();
  const expanded = prefs.codeExpanded || [];
  const cfgMap   = prefs.codeConfig   || {};

  const results = await Promise.all(CODE_TOOLS.map(t => new Promise(resolve => {
    const detectCmd = [
      `bash -lc "which ${t.cmd} 2>/dev/null"`,
      `{ test -f "$HOME/.npm-global/bin/${t.cmd}" && echo "$HOME/.npm-global/bin/${t.cmd}"; }`,
      `{ test -f "$HOME/.local/bin/${t.cmd}"      && echo "$HOME/.local/bin/${t.cmd}"; }`,
      `{ test -f "/usr/local/bin/${t.cmd}"        && echo "/usr/local/bin/${t.cmd}"; }`,
      `find "$HOME/.nvm/versions" -name "${t.cmd}" -type f 2>/dev/null | grep -m1 .`,
    ].join(' || ');
    exec(detectCmd, { env: { ...process.env, HOME: process.env.HOME || os.homedir() } }, (err, stdout) => {
      const detected = !!stdout.trim();
      let version = null;
      if (detected) {
        const bin = stdout.trim().split('\n')[0];
        try {
          const vOut = require('child_process').execSync(
            `bash -lc "'${bin}' --version 2>/dev/null || '${bin}' version 2>/dev/null"`,
            { timeout: 3000 }
          ).toString().trim();
          version = vOut.split('\n')[0].slice(0, 60);
        } catch {}
      }
      resolve({
        ...t,
        detected,
        version,
        pinned:     expanded.includes(t.id),
        configPath: cfgMap[t.id]?.configPath || '',
      });
    });
  })));

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

  sseHeaders(res);
  const sseWrite = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  let cmd = tool.installHint;
  const needsSudo = cmd.includes('sudo ') && typeof password === 'string' && password.length > 0;
  if (needsSudo) cmd = cmd.replace(/\bsudo\b/g, 'sudo -S');

  sseWrite({ status: `Installing ${tool.label}…\n$ ${tool.installHint}\n` });

  const child = spawn('bash', ['-lc', cmd], {
    cwd: process.env.HOME || os.homedir(),
    env: {
      ...process.env,
      HOME: process.env.HOME || os.homedir(),
      DEBIAN_FRONTEND: 'noninteractive',
      PATH: `${process.env.HOME || os.homedir()}/.local/bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (needsSudo) {
    child.stdin.write(password + '\n');
    child.stdin.end();
  }

  child.stdout.on('data', d => sseWrite({ status: d.toString() }));
  child.stderr.on('data', d => sseWrite({ status: d.toString() }));
  child.on('close', (code, signal) => {
    const ok  = code === 0;
    const msg = ok            ? '✓ Done'
      : code !== null         ? `✗ Exit ${code}`
      : `✗ Killed by signal (${signal || 'unknown'})`;
    sseWrite({ done: true, ok, status: msg });
    res.end();
  });
  child.on('error', e => {
    sseWrite({ done: true, ok: false, status: `Error: ${e.message}` });
    res.end();
  });
  res.on('close', () => { if (!child.killed) child.kill(); });
}

module.exports = { handleList, handlePin, handleConfig, handleInstall };
