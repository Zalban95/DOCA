'use strict';

const path = require('path');

const { detect } = require('./detect');

const { streamCmd } = require('./utils');
const { COMPOSE_DIR } = require('./paths');

const SYSTEM_TOOLS = [
  {
    id: 'node', label: 'Node.js', category: 'required',
    detect: { bin: process.execPath, args: ['--version'] },
    note: 'JavaScript runtime — the dashboard runs on Node.js',
    repo: 'https://github.com/nvm-sh/nvm', repoLabel: 'nvm (recommended)',
    installCmd: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install --lts`,
  },
  {
    id: 'npm', label: 'npm', category: 'required',
    detect: { bin: 'npm', args: ['--version'] },
    note: 'Package manager — bundled with Node.js',
    repo: 'https://github.com/nvm-sh/nvm', repoLabel: 'nvm (installs Node + npm)',
    installCmd: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install --lts`,
  },
  {
    id: 'node-pty', label: 'node-pty', category: 'recommended',
    detect: { bin: process.execPath, args: ['-e', "require('node-pty');console.log('ok')"], cwd: __dirname + '/..' },
    note: 'Only for embedded terminals (Terminal tab, Code launchers) — everything else works without it; active right after install. No password needed: installs user-level via npm',
    repo: 'https://www.npmjs.com/package/node-pty', repoLabel: 'npm: node-pty',
    // Native addon. Self-healing install:
    //  1. fail fast with a clear message when the C++ toolchain is missing;
    //  2. short-circuit when the module already loads;
    //  3. `npm install` reports "up to date" without rebuilding when the
    //     package folder exists but was compiled against another Node ABI
    //     (require() fails after a Node upgrade) → force `npm rebuild`,
    //     falling back to a forced reinstall;
    //  4. only report success when require() actually works.
    installCmd: [
      'if ! command -v g++ >/dev/null 2>&1 || ! command -v make >/dev/null 2>&1; then echo "✗ C++ build toolchain missing — install \\"Build tools\\" from this list first, then retry."; exit 1; fi',
      `if node -e "require('node-pty')" 2>/dev/null; then echo "✓ node-pty already builds & loads — nothing to do."; exit 0; fi`,
      'if [ -d node_modules/node-pty ]; then echo "node-pty present but not loadable (Node version changed?) — rebuilding…"; npm rebuild node-pty 2>&1 || npm install node-pty --force 2>&1; else echo "Installing node-pty…"; npm install node-pty 2>&1; fi',
      `node -e "require('node-pty')" 2>/dev/null || { echo "✗ node-pty still fails to load after (re)build — check the log above."; exit 1; }`,
      'echo "✓ node-pty built and verified."',
    ].join('; '),
    installCwd: __dirname + '/..',
  },
  {
    id: 'docker', label: 'Docker', category: 'recommended',
    detect: { bin: 'docker', args: ['--version'] },
    note: 'Container runtime — required for container management',
    repo: 'https://docs.docker.com/engine/install/', repoLabel: 'docs.docker.com',
    installCmd: 'curl -fsSL https://get.docker.com | sh',
  },
  {
    id: 'openclaw', label: 'OpenClaw', category: 'recommended',
    // COMPOSE_DIR, not a hardcoded ~/openclaw: the Controls tab drives the stack
    // through it, and a machine that overrides it would otherwise be told here
    // that OpenClaw is missing while the dashboard happily starts and stops it.
    // Falls back to "installed" so a stack that is not a git checkout (tarball,
    // vendored copy) still reports as present instead of offering to clone
    // over it — git clone into a non-empty directory fails.
    detect: { file: path.join(COMPOSE_DIR, 'docker-compose.yml'), gitRev: true },
    note: 'OpenClaw AI stack — Docker Compose services. Updating pulls the newest definition and images',
    repo: 'https://github.com/openclaw/openclaw', repoLabel: 'openclaw/openclaw',
    // `docker compose pull` matters: `up -d` only fetches images that are
    // absent locally, so without it an existing stack would be "updated" to
    // exactly the images it was already running.
    installCmd: `if [ -d "${COMPOSE_DIR}" ]; then cd "${COMPOSE_DIR}" && git pull; else git clone https://github.com/openclaw/openclaw.git "${COMPOSE_DIR}"; fi && cd "${COMPOSE_DIR}" && docker compose pull && docker compose up -d`,
  },
  {
    id: 'git', label: 'Git', category: 'recommended',
    detect: { bin: 'git', args: ['--version'] },
    note: 'Version control — required for skills management',
    repo: 'https://git-scm.com', repoLabel: 'apt: git',
    installCmd: 'sudo apt-get update && sudo apt-get install -y git',
  },
  {
    id: 'build-tools', label: 'Build tools', category: 'recommended',
    detect: { bin: 'g++', args: ['--version'] },
    note: 'C/C++ toolchain — needed to compile native addons (node-pty)',
    repo: 'https://packages.ubuntu.com/build-essential', repoLabel: 'apt: build-essential',
    installCmd: 'sudo apt-get update && sudo apt-get install -y build-essential python3',
  },
  {
    id: 'ollama', label: 'Ollama', category: 'recommended',
    detect: { bin: 'ollama', args: ['--version'] },
    note: 'Local LLM runtime — powers the Ollama model manager',
    repo: 'https://ollama.com', repoLabel: 'ollama.com',
    installCmd: 'curl -fsSL https://ollama.com/install.sh | sh',
    needsSudo: true, // install script escalates internally
  },
  {
    id: 'docker-compose', label: 'Docker Compose', category: 'recommended',
    detect: { bin: 'docker', args: ['compose', 'version'] },
    note: 'Compose v2 plugin — required for stack start/stop/restart',
    repo: 'https://docs.docker.com/compose/', repoLabel: 'apt: docker-compose-plugin',
    installCmd: 'sudo apt-get update && sudo apt-get install -y docker-compose-plugin',
  },
  {
    id: 'ffmpeg', label: 'ffmpeg', category: 'recommended',
    detect: { bin: 'ffmpeg', args: ['-version'] },
    note: 'Audio/video toolkit — used by voice (STT/TTS) features',
    repo: 'https://ffmpeg.org', repoLabel: 'apt: ffmpeg',
    installCmd: 'sudo apt-get update && sudo apt-get install -y ffmpeg',
  },
  {
    id: 'curl', label: 'curl', category: 'recommended',
    detect: { bin: 'curl', args: ['--version'] },
    note: 'HTTP client — used for service health checks and installers',
    repo: 'https://curl.se', repoLabel: 'apt: curl',
    installCmd: 'sudo apt-get update && sudo apt-get install -y curl',
  },
  {
    id: 'python3', label: 'Python 3', category: 'recommended',
    detect: { any: [{ bin: 'python3', args: ['--version'] }, { bin: 'python', args: ['--version'] }] },
    note: 'Required for Python-based AI tools (Aider, Whisper, Kokoro)',
    repo: 'https://python.org', repoLabel: 'apt: python3',
    installCmd: 'sudo apt-get update && sudo apt-get install -y python3 python3-pip python3-venv',
  },
  {
    id: 'pip', label: 'pip', category: 'recommended',
    detect: { any: [{ bin: 'pip3', args: ['--version'] }, { bin: 'pip', args: ['--version'] }, { bin: 'python3', args: ['-m', 'pip', '--version'] }] },
    note: 'Python package manager — required for AI tools',
    repo: 'https://pip.pypa.io', repoLabel: 'apt: python3-pip',
    installCmd: 'sudo apt-get install -y python3-pip',
  },
  {
    id: 'nvidia-smi', label: 'nvidia-smi', category: 'optional',
    detect: { any: [{ bin: 'nvidia-smi', args: ['--query-gpu=driver_version', '--format=csv,noheader'] }, { bin: 'nvidia-smi', args: [] }] },
    note: 'NVIDIA GPU monitoring — optional',
    repo: 'https://www.nvidia.com/drivers', repoLabel: 'nvidia.com/drivers',
    installCmd: null,
  },
  {
    id: 'huggingface-cli', label: 'huggingface-cli', category: 'optional',
    detect: { any: [{ bin: 'python3', args: ['-c', 'import huggingface_hub; print(huggingface_hub.__version__)'] }, { bin: 'huggingface-cli', args: ['--version'] }] },
    note: 'HuggingFace Hub CLI — for downloading local models',
    repo: 'https://pypi.org/project/huggingface-hub/', repoLabel: 'pip: huggingface-hub',
    installCmd: 'pip install --user --break-system-packages "huggingface_hub[cli]"',
  },
  {
    id: 'llama-server', label: 'llama-server', category: 'optional',
    detect: { bin: 'llama-server', args: ['--version'], stderr: true, match: /version/i },
    note: 'llama.cpp server binary — required by the llama.cpp Servers manager',
    repo: 'https://github.com/ggml-org/llama.cpp/releases', repoLabel: 'llama.cpp releases (manual)',
    installCmd: null,
  },
];

/** GET /api/system/tools */
async function handleList(req, res) {
  // Each row declares what it looks for (modules/detect.js): no shell line,
  // so a tool is found on Windows as it is on Linux.
  const results = await Promise.all(SYSTEM_TOOLS.map(t => detect(t.detect)
    .then(({ detected, version }) => {
        return ({
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
