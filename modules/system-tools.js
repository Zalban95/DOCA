'use strict';

const os = require('os');
const { exec } = require('child_process');

const { streamCmd } = require('./utils');

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
    id: 'openclaw', label: 'OpenClaw', category: 'recommended',
    detectCmd: 'test -f "$HOME/openclaw/docker-compose.yml" && cd "$HOME/openclaw" && git log -1 --format="rev %h (%cr)" 2>/dev/null',
    note: 'OpenClaw AI stack — clone repo and start Docker Compose services',
    repo: 'https://github.com/openclaw/openclaw', repoLabel: 'openclaw/openclaw',
    installCmd: 'if [ -d "$HOME/openclaw" ]; then cd "$HOME/openclaw" && git pull; else git clone https://github.com/openclaw/openclaw.git "$HOME/openclaw"; fi && cd "$HOME/openclaw" && docker compose up -d',
  },
  {
    id: 'git', label: 'Git', category: 'recommended',
    detectCmd: 'git --version 2>/dev/null',
    note: 'Version control — required for skills management',
    repo: 'https://git-scm.com', repoLabel: 'apt: git',
    installCmd: 'sudo apt-get update && sudo apt-get install -y git',
  },
  {
    id: 'ollama', label: 'Ollama', category: 'recommended',
    detectCmd: 'ollama --version 2>/dev/null',
    note: 'Local LLM runtime — powers the Ollama model manager',
    repo: 'https://ollama.com', repoLabel: 'ollama.com',
    installCmd: 'curl -fsSL https://ollama.com/install.sh | sh',
    needsSudo: true, // install script escalates internally
  },
  {
    id: 'docker-compose', label: 'Docker Compose', category: 'recommended',
    detectCmd: 'docker compose version 2>/dev/null',
    note: 'Compose v2 plugin — required for stack start/stop/restart',
    repo: 'https://docs.docker.com/compose/', repoLabel: 'apt: docker-compose-plugin',
    installCmd: 'sudo apt-get update && sudo apt-get install -y docker-compose-plugin',
  },
  {
    id: 'ffmpeg', label: 'ffmpeg', category: 'recommended',
    detectCmd: 'ffmpeg -version 2>/dev/null | head -1',
    note: 'Audio/video toolkit — used by voice (STT/TTS) features',
    repo: 'https://ffmpeg.org', repoLabel: 'apt: ffmpeg',
    installCmd: 'sudo apt-get update && sudo apt-get install -y ffmpeg',
  },
  {
    id: 'curl', label: 'curl', category: 'recommended',
    detectCmd: 'curl --version 2>/dev/null | head -1',
    note: 'HTTP client — used for service health checks and installers',
    repo: 'https://curl.se', repoLabel: 'apt: curl',
    installCmd: 'sudo apt-get update && sudo apt-get install -y curl',
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
  {
    id: 'llama-server', label: 'llama-server', category: 'optional',
    detectCmd: 'llama-server --version 2>&1 | head -1 | grep -i version',
    note: 'llama.cpp server binary — required by the llama.cpp Servers manager',
    repo: 'https://github.com/ggml-org/llama.cpp/releases', repoLabel: 'llama.cpp releases (manual)',
    installCmd: null,
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
          needsSudo:    !!t.needsSudo || !!(t.installCmd && t.installCmd.includes('sudo ')),
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

  streamCmd(res, tool.installCmd, {
    label:    tool.label,
    cwd:      tool.installCwd,
    password: typeof password === 'string' && password.length > 0 ? password : undefined,
  });
}

module.exports = { SYSTEM_TOOLS, handleList, handleInstall };
