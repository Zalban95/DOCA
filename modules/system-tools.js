'use strict';

const os = require('os');
const { exec, spawn } = require('child_process');

const { sseHeaders } = require('./utils');

const SYSTEM_TOOLS = [
  {
    id: 'node', label: 'Node.js', category: 'required',
    detectCmd: 'node --version 2>/dev/null',
    note: 'JavaScript runtime — the dashboard runs on Node.js',
    repo: 'https://github.com/nvm-sh/nvm', repoLabel: 'nvm (recommended)',
    installCmd: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install --lts`,
  },
  {
    id: 'npm', label: 'npm', category: 'required',
    detectCmd: 'npm --version 2>/dev/null',
    note: 'Package manager — bundled with Node.js',
    repo: 'https://github.com/nvm-sh/nvm', repoLabel: 'nvm (installs Node + npm)',
    installCmd: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install --lts`,
  },
  {
    id: 'node-pty', label: 'node-pty', category: 'required',
    detectCmd: `node -e "require('node-pty');console.log('ok')" 2>/dev/null`,
    note: 'Native PTY addon — required for embedded terminals',
    repo: 'https://www.npmjs.com/package/node-pty', repoLabel: 'npm: node-pty',
    installCmd: 'npm install node-pty',
    installCwd: __dirname + '/..',
    detectCwd:  __dirname + '/..',
  },
  {
    id: 'docker', label: 'Docker', category: 'recommended',
    detectCmd: 'docker --version 2>/dev/null',
    note: 'Container runtime — required for container management',
    repo: 'https://docs.docker.com/engine/install/', repoLabel: 'docs.docker.com',
    installCmd: 'curl -fsSL https://get.docker.com | sh',
  },
  {
    id: 'git', label: 'Git', category: 'recommended',
    detectCmd: 'git --version 2>/dev/null',
    note: 'Version control — required for skills management',
    repo: 'https://git-scm.com', repoLabel: 'apt: git',
    installCmd: 'sudo apt-get update && sudo apt-get install -y git',
  },
  {
    id: 'python3', label: 'Python 3', category: 'recommended',
    detectCmd: 'python3 --version 2>/dev/null || python --version 2>/dev/null',
    note: 'Required for Python-based AI tools (Aider, Whisper, Kokoro)',
    repo: 'https://python.org', repoLabel: 'apt: python3',
    installCmd: 'sudo apt-get update && sudo apt-get install -y python3 python3-pip python3-venv',
  },
  {
    id: 'pip', label: 'pip', category: 'recommended',
    detectCmd: 'PATH="$HOME/.local/bin:$PATH" pip3 --version 2>/dev/null || PATH="$HOME/.local/bin:$PATH" pip --version 2>/dev/null || python3 -m pip --version 2>/dev/null',
    note: 'Python package manager — required for AI tools',
    repo: 'https://pip.pypa.io', repoLabel: 'apt: python3-pip',
    installCmd: 'sudo apt-get install -y python3-pip',
  },
  {
    id: 'nvidia-smi', label: 'nvidia-smi', category: 'optional',
    detectCmd: 'nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null || nvidia-smi 2>/dev/null | head -1',
    note: 'NVIDIA GPU monitoring — optional',
    repo: 'https://www.nvidia.com/drivers', repoLabel: 'nvidia.com/drivers',
    installCmd: null,
  },
  {
    id: 'huggingface-cli', label: 'huggingface-cli', category: 'optional',
    detectCmd: 'python3 -c "import huggingface_hub; print(huggingface_hub.__version__)" 2>/dev/null || PATH="$HOME/.local/bin:$PATH" huggingface-cli --version 2>/dev/null',
    note: 'HuggingFace Hub CLI — for downloading local models',
    repo: 'https://pypi.org/project/huggingface-hub/', repoLabel: 'pip: huggingface-hub',
    installCmd: 'pip install --user --break-system-packages "huggingface_hub[cli]"',
  },
];

/** GET /api/system/tools */
async function handleList(req, res) {
  const results = await Promise.all(SYSTEM_TOOLS.map(t => new Promise(resolve => {
    exec(`bash -lc "${t.detectCmd.replace(/"/g, '\\"')}"`,
      { env: { ...process.env, HOME: process.env.HOME || os.homedir() }, cwd: t.detectCwd || undefined, timeout: 5000 },
      (err, stdout) => {
        const out      = stdout.trim();
        const detected = !err && !!out && out !== '' && out.toLowerCase() !== 'undefined';
        const version  = detected ? out.split('\n')[0].replace(/^v/, '').slice(0, 60) : null;
        resolve({
          id:           t.id,
          label:        t.label,
          category:     t.category,
          note:         t.note,
          repo:         t.repo,
          repoLabel:    t.repoLabel,
          canInstall:   !!t.installCmd,
          installCmd:   t.installCmd || null,
          detected,
          version,
        });
      }
    );
  })));

  res.json({ tools: results });
}

/** POST /api/system/tools/install — SSE progress */
function handleInstall(req, res) {
  const { id, password } = req.body;
  const tool = SYSTEM_TOOLS.find(t => t.id === id);
  if (!tool || !tool.installCmd) return res.status(400).json({ error: 'No install command for this tool' });

  sseHeaders(res);
  const sseWrite = d => res.write(`data: ${JSON.stringify(d)}\n\n`);

  let cmd = tool.installCmd;
  const needsSudo = cmd.includes('sudo ') && typeof password === 'string' && password.length > 0;
  if (needsSudo) cmd = cmd.replace(/\bsudo\b/g, 'sudo -S');

  sseWrite({ status: `Installing ${tool.label}…\n$ ${tool.installCmd}` });

  const home = process.env.HOME || os.homedir();
  const child = spawn('bash', ['-lc', cmd], {
    cwd:   tool.installCwd || home,
    env:   { ...process.env, HOME: home, DEBIAN_FRONTEND: 'noninteractive' },
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
    const msg = ok ? '✓ Done'
      : code !== null ? `✗ Exit ${code}`
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

module.exports = { handleList, handleInstall };
