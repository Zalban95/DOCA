'use strict';

/**
 * What this machine has for DOCA (Settings → System → System tools): what it needs, what makes it better, what only
 * some features use, and what building DOCA's own apps takes. Each row declares how it is found (modules/detect.js —
 * no shell, the same on every OS) and how it is installed **per OS**: `linux` (apt, dnf or pacman — whichever the
 * machine has), `darwin` (Homebrew), `win32` (winget, in PowerShell). A row with no command for this OS shows its
 * link instead of a button. Nothing here is installed by itself: a person presses Install and sees the command run.
 */
const os = require('os');
const path = require('path');
const { COMPOSE_DIR } = require('./paths');

const HOME = os.homedir();

/** A Linux package by its name in each family, installed with whichever manager this machine has. */
function pkg({ apt, dnf = apt, pacman = apt }) {
  return `if command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y ${apt}; `
    + `elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y ${dnf}; `
    + `elif command -v pacman >/dev/null 2>&1; then sudo pacman -S --noconfirm ${pacman}; `
    + `else echo "No apt, dnf or pacman here: install ${apt} with this system's package manager."; exit 1; fi`;
}
const brew = (what, cask = false) => `command -v brew >/dev/null 2>&1 || { echo "Homebrew is needed first: https://brew.sh"; exit 1; }; brew install ${cask ? '--cask ' : ''}${what}`;
const winget = id => `winget install --id ${id} -e --silent --accept-package-agreements --accept-source-agreements`;

// The Android SDK's command-line tools, unpacked where Android Studio puts the SDK, then what the apps compile against.
// The SDK's licence is accepted on the person's behalf when they press Install (the row's note says so).
// Newer platforms are named with their minor version (android-37.0). The newest command-line tools are Google's
// "Android CLI" (`bin/android`; its device profiles are small_phone, medium_phone, … — and it exits 0 on some errors; sdkmanager is a wrapper around it), which uploads usage data on every run unless that run
// says --no-metrics — and sdkmanager does not take the flag. So the CLI is called directly, with it, and sdkmanager
// only where the tools predate the CLI (found live, 2026-10-05: the first install had uploaded once).
const ANDROID_PKGS = '"platform-tools" "platforms;android-35" "platforms;android-37.0" "build-tools;35.0.0"';
const ANDROID_CLI_PKGS = ANDROID_PKGS.replace(/;/g, '/');
const androidPosix = plat => [
  `SDK="\${ANDROID_HOME:-$HOME/${plat === 'mac' ? 'Library/Android/sdk' : 'Android/Sdk'}}"`,
  'mkdir -p "$SDK/cmdline-tools" && cd "$SDK"',
  `ZIP=$(curl -fsSL https://dl.google.com/android/repository/repository2-3.xml | grep -o 'commandlinetools-${plat}-[0-9]*_latest.zip' | head -1)`,
  '[ -n "$ZIP" ] || { echo "Could not find the command-line tools on dl.google.com."; exit 1; }',
  'echo "Downloading $ZIP…" && curl -fsSLo cl.zip "https://dl.google.com/android/repository/$ZIP"',
  'rm -rf cmdline-tools/latest cmdline-tools/cmdline-tools',
  '(unzip -q cl.zip -d cmdline-tools 2>/dev/null || python3 -m zipfile -e cl.zip cmdline-tools) && mv cmdline-tools/cmdline-tools cmdline-tools/latest && rm cl.zip && chmod +x cmdline-tools/latest/bin/*',
  `if [ -x cmdline-tools/latest/bin/android ]; then cmdline-tools/latest/bin/android --no-metrics sdk install ${ANDROID_CLI_PKGS} </dev/null; `
    + `else yes | cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null && cmdline-tools/latest/bin/sdkmanager ${ANDROID_PKGS}; fi`,
  'echo "✓ Android SDK in $SDK — builds find it through ANDROID_HOME=$SDK (or sdk.dir in local.properties)."',
].join(' && ');
const androidWin = [
  '$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\\Android\\Sdk" }',
  'New-Item -ItemType Directory -Force "$sdk\\cmdline-tools" | Out-Null',
  '$zip = [regex]::Match((Invoke-WebRequest -UseBasicParsing https://dl.google.com/android/repository/repository2-3.xml).Content, "commandlinetools-win-\\d+_latest\\.zip").Value',
  'Invoke-WebRequest -UseBasicParsing "https://dl.google.com/android/repository/$zip" -OutFile "$sdk\\cl.zip"',
  'Remove-Item -Recurse -Force "$sdk\\cmdline-tools\\latest" -ErrorAction SilentlyContinue',
  'Expand-Archive -Force "$sdk\\cl.zip" "$sdk\\cmdline-tools"; Rename-Item "$sdk\\cmdline-tools\\cmdline-tools" latest; Remove-Item "$sdk\\cl.zip"',
  '$bin = "$sdk\\cmdline-tools\\latest\\bin"',
  `if (Test-Path "$bin\\android.bat") { & "$bin\\android.bat" --no-metrics sdk install ${ANDROID_CLI_PKGS} } elseif (Test-Path "$bin\\android.exe") { & "$bin\\android.exe" --no-metrics sdk install ${ANDROID_CLI_PKGS} } `
    + `else { 1..20 | ForEach-Object { "y" } | & "$bin\\sdkmanager.bat" --licenses | Out-Null; & "$bin\\sdkmanager.bat" ${ANDROID_PKGS} }`,
  '[Environment]::SetEnvironmentVariable("ANDROID_HOME", $sdk, "User"); "Android SDK in $sdk (ANDROID_HOME set for this user)"',
].join('; ');
const androidHome = process.env.ANDROID_HOME || (process.platform === 'darwin' ? path.join(HOME, 'Library/Android/sdk')
  : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || HOME, 'Android', 'Sdk') : path.join(HOME, 'Android/Sdk'));
const sdkmanager = path.join(androidHome, 'cmdline-tools', 'latest', 'bin', process.platform === 'win32' ? 'sdkmanager.bat' : 'sdkmanager');
const androidCli = path.join(androidHome, 'cmdline-tools', 'latest', 'bin', process.platform === 'win32' ? 'android.bat' : 'android');

const DOTNET_POSIX = 'curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 9.0 --install-dir "$HOME/.dotnet" && echo "✓ .NET 9 SDK in ~/.dotnet — add it to PATH: export PATH=\\"$HOME/.dotnet:$PATH\\""';

const NVIDIA_CTK = [
  'curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --yes --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg',
  'curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed "s#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g" | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null',
  'sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit',
  'sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker',
].join(' && ');

/**
 * A Temurin JDK where Gradle looks for toolchains by itself (~/.gradle/jdks), carrying the markers Gradle's own
 * provisioned JDKs have (.ready, provisioned.ok) so it trusts the folder: no sudo, nothing on PATH changed.
 */
function temurin(v, forWhat, why) {
  const dir = path.join(HOME, '.gradle', 'jdks', `temurin-${v}`);
  // javac, not java: a runtime without a compiler (Ubuntu's openjdk-NN-jre) is not a JDK, and Gradle cannot use it.
  const javac = (...p) => ({ bin: path.join(...p, process.platform === 'win32' ? 'javac.exe' : 'javac'), args: ['-version'], stderr: true, match: /javac/ });
  return { id: `jdk${v}`, label: `JDK ${v} toolchain`, category: 'clients', for: forWhat,
    detect: { any: [javac(dir, 'bin'), javac(dir, 'Contents', 'Home', 'bin'), javac(`/usr/lib/jvm/java-${v}-openjdk-amd64`, 'bin')] },
    version: /javac ([\d.]+)/,
    note: `${why} Eclipse Temurin ${v} in ~/.gradle/jdks/temurin-${v}, where Gradle finds it.`,
    repo: `https://adoptium.net/temurin/releases/?version=${v}`, repoLabel: 'adoptium.net',
    install: { all: `OS=$(uname -s | tr A-Z a-z | sed s/darwin/mac/); ARCH=$(uname -m | sed "s/x86_64/x64/;s/arm64/aarch64/"); D="$HOME/.gradle/jdks"; mkdir -p "$D" && cd "$D" && rm -rf temurin-${v} t${v}.tgz && echo "Downloading Temurin ${v} ($OS/$ARCH)…" && curl -fsSLo t${v}.tgz "https://api.adoptium.net/v3/binary/latest/${v}/ga/$OS/$ARCH/jdk/hotspot/normal/eclipse" && mkdir temurin-${v} && tar -xzf t${v}.tgz -C temurin-${v} --strip-components=1 && rm t${v}.tgz && touch temurin-${v}/.ready temurin-${v}/provisioned.ok && echo "✓ JDK ${v} in $D/temurin-${v} — Gradle finds it there."`,
      win32: `$d = "$HOME\\.gradle\\jdks"; New-Item -ItemType Directory -Force $d | Out-Null; Invoke-WebRequest -UseBasicParsing "https://api.adoptium.net/v3/binary/latest/${v}/ga/windows/x64/jdk/hotspot/normal/eclipse" -OutFile "$d\\t${v}.zip"; Remove-Item -Recurse -Force "$d\\temurin-${v}" -ErrorAction SilentlyContinue; Expand-Archive -Force "$d\\t${v}.zip" "$d\\t${v}"; Move-Item (Get-ChildItem "$d\\t${v}")[0].FullName "$d\\temurin-${v}"; Remove-Item -Recurse "$d\\t${v}", "$d\\t${v}.zip"; New-Item -ItemType File "$d\\temurin-${v}\\.ready", "$d\\temurin-${v}\\provisioned.ok" | Out-Null; "JDK ${v} in $d\\temurin-${v}"` } };
}

const SYSTEM_TOOLS = [
  // ── What DOCA runs on ──
  { id: 'node', label: 'Node.js', category: 'required', for: 'DOCA itself',
    detect: { bin: process.execPath, args: ['--version'] }, update: false,
    note: 'DOCA runs on it (22.5 or newer). Updated with its own installer, outside the panel — the panel cannot replace the runtime it is running on.',
    repo: 'https://nodejs.org/en/download', repoLabel: 'nodejs.org' },
  { id: 'npm', label: 'npm', category: 'required', for: 'DOCA itself',
    detect: { bin: 'npm', args: ['--version'] }, update: false,
    note: 'Comes with Node.js; installs DOCA\'s own packages.', repo: 'https://nodejs.org/en/download', repoLabel: 'with Node.js' },

  // ── What makes it whole ──
  { id: 'git', label: 'Git', category: 'recommended', for: 'updates, projects, skills',
    detect: { bin: 'git', args: ['--version'] },
    note: 'How DOCA updates itself and switches versions, and what Projects and skills are kept in.',
    repo: 'https://git-scm.com/downloads', repoLabel: 'git-scm.com',
    install: { linux: pkg({ apt: 'git' }), darwin: brew('git'), win32: winget('Git.Git') } },
  { id: 'tailscale', label: 'Tailscale', category: 'recommended', for: 'reaching your devices',
    detect: { bin: 'tailscale', args: ['version'] },
    note: 'The private network your phone, watch, other computers and the browser extension reach this hub over — from anywhere, with no port opened.',
    repo: 'https://tailscale.com/download', repoLabel: 'tailscale.com',
    install: { linux: 'curl -fsSL https://tailscale.com/install.sh | sh && echo "Now sign in: sudo tailscale up"', darwin: brew('tailscale-app', true), win32: winget('Tailscale.Tailscale') }, needsSudo: true },
  { id: 'docker', label: 'Docker', category: 'recommended', for: 'services, agents\' computers, the Docker tab',
    detect: { any: [{ bin: 'docker', args: ['--version'] }, { bin: 'podman', args: ['--version'] }] },
    note: 'Runs the inference services (Whisper, Kokoro, ComfyUI…) and the agents\' computers. Podman works in its place.',
    repo: 'https://docs.docker.com/engine/install/', repoLabel: 'docs.docker.com',
    install: { linux: 'curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker "$USER" && echo "Sign out and in again to use docker without sudo."', darwin: brew('docker', true), win32: winget('Docker.DockerDesktop') }, needsSudo: true },
  { id: 'docker-compose', label: 'Docker Compose', category: 'recommended', for: 'compose stacks',
    detect: { any: [{ bin: 'docker', args: ['compose', 'version'] }, { bin: 'podman', args: ['compose', 'version'] }] },
    note: 'Compose v2 — for stacks such as OpenClaw\'s. Docker Desktop includes it.',
    repo: 'https://docs.docker.com/compose/install/', repoLabel: 'docs.docker.com/compose',
    install: { linux: pkg({ apt: 'docker-compose-plugin', dnf: 'docker-compose-plugin', pacman: 'docker-compose' }) } },
  { id: 'node-pty', label: 'node-pty', category: 'recommended', for: 'the Terminal tab',
    detect: { bin: process.execPath, args: ['-e', "require('node-pty');console.log('loads')"], cwd: path.join(__dirname, '..') },
    note: 'Only the embedded terminals (the Terminal tab, harness launchers) need it; built for this Node, no password.',
    repo: 'https://www.npmjs.com/package/node-pty', repoLabel: 'npm: node-pty',
    // Self-healing: a clear message without a compiler; nothing to do when it loads; rebuild when a Node upgrade broke it.
    install: { all: [
      `node -e "require('node-pty')" 2>/dev/null && { echo "✓ node-pty already loads — nothing to do."; exit 0; }`,
      'if [ -d node_modules/node-pty ]; then echo "Rebuilding node-pty for this Node…"; npm rebuild node-pty 2>&1 || npm install node-pty --force 2>&1; else npm install node-pty 2>&1; fi',
      `node -e "require('node-pty')" 2>/dev/null || { echo "✗ node-pty does not load — it needs a C++ compiler: install Build tools from this list, then retry."; exit 1; }`,
      'echo "✓ node-pty built and loads."',
    ].join('; '), win32: 'npm rebuild node-pty; if ($LASTEXITCODE) { npm install node-pty --force }; node -e "require(\'node-pty\')"; if ($LASTEXITCODE) { "node-pty does not load: install Visual Studio Build Tools (C++)" } else { "node-pty loads" }' },
    installCwd: path.join(__dirname, '..') },
  { id: 'build-tools', label: 'Build tools', category: 'recommended', for: 'node-pty',
    detect: { any: [{ bin: 'g++', args: ['--version'] }, { bin: 'clang++', args: ['--version'] }, { bin: 'cl', args: [], stderr: true, match: /Version/ }] },
    note: 'A C/C++ compiler, to build node-pty for this Node.',
    repo: 'https://visualstudio.microsoft.com/visual-cpp-build-tools/', repoLabel: 'gcc / Xcode CLT / VS Build Tools',
    install: { linux: pkg({ apt: 'build-essential python3', dnf: 'gcc-c++ make python3', pacman: 'base-devel python' }), darwin: 'xcode-select --install', win32: winget('Microsoft.VisualStudio.2022.BuildTools') } },
  { id: 'curl', label: 'curl', category: 'recommended', for: 'installers, health checks',
    detect: { bin: 'curl', args: ['--version'] }, note: 'Fetches what the installers here download.',
    repo: 'https://curl.se', repoLabel: 'curl.se', install: { linux: pkg({ apt: 'curl' }), darwin: brew('curl'), win32: winget('cURL.cURL') } },

  // ── For the features that use them ──
  { id: 'ollama', label: 'Ollama', category: 'optional', for: 'local models',
    detect: { bin: 'ollama', args: ['--version'] }, note: 'Runs language and vision models on this machine — the Models tab\'s Ollama, and the default for local embeddings.',
    repo: 'https://ollama.com/download', repoLabel: 'ollama.com',
    install: { linux: 'curl -fsSL https://ollama.com/install.sh | sh', darwin: brew('ollama'), win32: winget('Ollama.Ollama') }, needsSudo: true },
  { id: 'llama-server', label: 'llama-server', category: 'optional', for: 'the llama.cpp servers',
    detect: { bin: 'llama-server', args: ['--version'], stderr: true, match: /version/i }, version: /version:\s*(\d+)/,
    note: 'llama.cpp\'s server — the Models tab runs GGUF files with it.',
    repo: 'https://github.com/ggml-org/llama.cpp/releases', repoLabel: 'llama.cpp releases',
    install: { darwin: brew('llama.cpp'), win32: winget('ggml.llamacpp') } },
  { id: 'nvidia-smi', label: 'NVIDIA driver', category: 'optional', for: 'GPU readings',
    detect: { any: [{ bin: 'nvidia-smi', args: ['--query-gpu=driver_version', '--format=csv,noheader'] }, { bin: 'nvidia-smi', args: [] }] },
    note: 'The sidebar\'s GPU readings and GPU services. A driver is the system\'s to install.', repo: 'https://www.nvidia.com/drivers', repoLabel: 'nvidia.com/drivers' },
  { id: 'nvidia-ctk', label: 'NVIDIA Container Toolkit', category: 'optional', for: 'GPUs in containers',
    detect: { bin: 'nvidia-ctk', args: ['--version'] },
    note: 'Lets the services\' containers use the GPU (Docker\'s --gpus). Installing restarts Docker, so running containers restart.',
    repo: 'https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html', repoLabel: 'NVIDIA docs',
    install: { linux: NVIDIA_CTK } },
  { id: 'uv', label: 'uv (Python)', category: 'optional', for: 'training a wake word',
    detect: { bin: 'uv', args: ['--version'] }, note: 'Makes the Python environment a wake-word model is trained in (modules/wakeword), with the Python it needs.',
    repo: 'https://docs.astral.sh/uv/', repoLabel: 'docs.astral.sh/uv', install: { linux: 'curl -LsSf https://astral.sh/uv/install.sh | sh', darwin: brew('uv'), win32: winget('astral-sh.uv') } },
  { id: 'ffmpeg', label: 'ffmpeg', category: 'optional', for: 'audio and video',
    detect: { bin: 'ffmpeg', args: ['-version'] }, note: 'Converts audio and video for voice and media.',
    repo: 'https://ffmpeg.org/download.html', repoLabel: 'ffmpeg.org', install: { linux: pkg({ apt: 'ffmpeg' }), darwin: brew('ffmpeg'), win32: winget('Gyan.FFmpeg') } },
  { id: 'python3', label: 'Python 3', category: 'optional', for: 'Python tools',
    detect: { any: [{ bin: 'python3', args: ['--version'] }, { bin: 'python', args: ['--version'] }, { bin: 'py', args: ['--version'] }] },
    note: 'For Python tools and harnesses (Aider, the Hugging Face CLI) and projects\' venvs. The voice services run in containers and do not need it.',
    repo: 'https://www.python.org/downloads/', repoLabel: 'python.org',
    install: { linux: pkg({ apt: 'python3 python3-pip python3-venv', dnf: 'python3 python3-pip', pacman: 'python python-pip' }), darwin: brew('python'), win32: winget('Python.Python.3.13') } },
  { id: 'pip', label: 'pip', category: 'optional', for: 'Python tools',
    detect: { any: [{ bin: 'pip3', args: ['--version'] }, { bin: 'pip', args: ['--version'] }, { bin: 'python3', args: ['-m', 'pip', '--version'] }] },
    note: 'Python\'s package installer.', repo: 'https://pip.pypa.io', repoLabel: 'pip.pypa.io',
    install: { linux: pkg({ apt: 'python3-pip', dnf: 'python3-pip', pacman: 'python-pip' }) } },
  { id: 'huggingface-cli', label: 'Hugging Face CLI', category: 'optional', for: 'downloading models',
    detect: { any: [{ bin: 'hf', args: ['version'] }, { bin: 'huggingface-cli', args: ['version'] }, { bin: 'python3', args: ['-c', 'import huggingface_hub; print(huggingface_hub.__version__)'] }] },
    note: 'Downloads models and datasets for the Models tab.', repo: 'https://pypi.org/project/huggingface-hub/', repoLabel: 'pip: huggingface-hub',
    install: { linux: 'python3 -m pip install --user --break-system-packages -U "huggingface_hub[cli]"', darwin: brew('huggingface-cli'), win32: 'py -m pip install --user -U "huggingface_hub[cli]"' } },
  { id: 'tesseract', label: 'Tesseract OCR', category: 'optional', for: 'reading a computer\'s screen',
    detect: { bin: 'tesseract', args: ['--version'] }, note: 'Reads the words on a screen and where they are, with no model (computer_look, text).',
    repo: 'https://github.com/tesseract-ocr/tesseract', repoLabel: 'tesseract-ocr',
    install: { linux: pkg({ apt: 'tesseract-ocr', dnf: 'tesseract', pacman: 'tesseract tesseract-data-eng' }), darwin: brew('tesseract'), win32: winget('UB-Mannheim.TesseractOCR') } },
  { id: 'opencv', label: 'OpenCV (Python)', category: 'optional', for: 'reading a computer\'s screen',
    detect: { any: [{ bin: 'python3', args: ['-c', 'import cv2; print(cv2.__version__)'] }, { bin: 'python', args: ['-c', 'import cv2; print(cv2.__version__)'] }] },
    note: 'Finds a picture of an element anywhere on a screen, with no model (computer_look, template).',
    repo: 'https://pypi.org/project/opencv-python-headless/', repoLabel: 'pip: opencv-python-headless',
    install: { linux: 'python3 -m pip install --user --break-system-packages -U opencv-python-headless', darwin: 'python3 -m pip install --user -U opencv-python-headless', win32: 'py -m pip install --user -U opencv-python-headless' } },
  { id: 'openclaw', label: 'OpenClaw', category: 'optional', for: 'the OpenClaw harness',
    // COMPOSE_DIR, not a hardcoded ~/openclaw: a machine that overrides it is still found. A stack that is not a git
    // checkout reads "installed" rather than offering to clone over it.
    detect: { file: path.join(COMPOSE_DIR, 'docker-compose.yml'), gitRev: true },
    note: 'Another agent stack, run with Docker Compose — a peer harness, not a prerequisite. Updating pulls its newest definition and images.',
    repo: 'https://github.com/openclaw/openclaw', repoLabel: 'openclaw/openclaw',
    install: { linux: `if [ -d "${COMPOSE_DIR}" ]; then cd "${COMPOSE_DIR}" && git pull; else git clone https://github.com/openclaw/openclaw.git "${COMPOSE_DIR}"; fi && cd "${COMPOSE_DIR}" && docker compose pull && docker compose up -d`,
      darwin: `if [ -d "${COMPOSE_DIR}" ]; then cd "${COMPOSE_DIR}" && git pull; else git clone https://github.com/openclaw/openclaw.git "${COMPOSE_DIR}"; fi && cd "${COMPOSE_DIR}" && docker compose pull && docker compose up -d` } },
  { id: 'libvirt', label: 'libvirt (virsh)', category: 'optional', for: 'the VMs tab',
    detect: { bin: 'virsh', args: ['--version'] }, note: 'KVM virtual machines in the VMs tab. VirtualBox, Hyper-V, UTM and Parallels are found on their own.',
    repo: 'https://libvirt.org', repoLabel: 'libvirt.org',
    install: { linux: pkg({ apt: 'libvirt-clients libvirt-daemon-system qemu-kvm', dnf: '@virtualization', pacman: 'libvirt qemu-full' }) }, needsSudo: true },

  // ── For building DOCA's own apps (DocaMobile, DocaWear, DocaDesk) ──
  { id: 'jdk', label: 'Java (JDK 17+)', category: 'clients', for: 'DocaMobile, DocaWear',
    // javac, not java: Ubuntu's openjdk-NN-jre is a runtime that cannot compile, and Gradle refuses it as a JDK.
    detect: { bin: 'javac', args: ['-version'], stderr: true, match: /javac/ }, version: /javac ([\d.]+)/,
    note: 'A JDK on PATH (javac), for Gradle and other Java tools. DocaMobile\'s Gradle can fetch a JDK of its own to run on; DocaWear\'s needs one of the toolchains below.', repo: 'https://adoptium.net', repoLabel: 'adoptium.net',
    install: { linux: pkg({ apt: 'openjdk-21-jdk', dnf: 'java-21-openjdk-devel', pacman: 'jdk21-openjdk' }), darwin: brew('openjdk@21'), win32: winget('Microsoft.OpenJDK.21') } },
  temurin(11, 'DocaMobile\'s core-doca', 'core-doca compiles against Java 11 (its Gradle toolchain); Gradle runs on the JDK above.'),
  temurin(21, 'DocaWear\'s Gradle', 'DocaWear builds with Gradle 8.12, which runs on Java up to 23 — not on 25. Pointed at with JAVA_HOME, or found by Gradle as a toolchain.'),
  { id: 'android-sdk', label: 'Android SDK', category: 'clients', for: 'DocaMobile, DocaWear',
    // The Android CLI first, told not to report usage: this check runs every time the section is opened.
    detect: { any: [{ bin: androidCli, args: ['--no-metrics', '--version'] }, { bin: sdkmanager, args: ['--version'] }, { bin: 'sdkmanager', args: ['--version'] }] },
    note: 'The command-line tools, platform tools and the platforms the apps compile against (35, 37) — about 1 GB, no Android Studio. Installing accepts the Android SDK licence (developer.android.com/studio/terms) for you, and turns off the tools\' usage reporting.',
    repo: 'https://developer.android.com/studio#command-line-tools-only', repoLabel: 'developer.android.com',
    install: { linux: androidPosix('linux'), darwin: androidPosix('mac'), win32: androidWin } },
  { id: 'android-emulator', label: 'Android emulator', category: 'clients', for: 'trying DocaMobile',
    detect: { bin: path.join(androidHome, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator'), args: ['-version'], match: /Android emulator version/i },
    version: /version ([\d.]+)/,
    note: 'A phone on this machine, made by the Android CLI (its system image, about 2 GB) — to run the app against this hub without a real phone. Needs the Android SDK above, and hardware virtualisation (KVM on Linux).',
    repo: 'https://developer.android.com/studio/run/emulator', repoLabel: 'developer.android.com',
    install: { all: `B="\${ANDROID_HOME:-$HOME/${process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk'}}/cmdline-tools/latest/bin"; [ -x "$B/android" ] || { echo "Install the Android SDK first (the row above)."; exit 1; }; "$B/android" --no-metrics emulator create medium_phone </dev/null; L=$("$B/android" --no-metrics emulator list 2>&1); echo "$L"; echo "$L" | grep -qiv "no .*device\\|^$" || { echo "✗ No virtual device was made (see above): the Android CLI reports some errors with a success code."; exit 1; }`,
      win32: `$b = "$(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\\Android\\Sdk" })\\cmdline-tools\\latest\\bin"; & "$b\\android.bat" --no-metrics emulator create medium_phone; & "$b\\android.bat" --no-metrics emulator list` } },
  { id: 'dotnet', label: '.NET 9 SDK', category: 'clients', for: 'DocaDesk',
    detect: { any: [{ bin: 'dotnet', args: ['--version'] }, { bin: path.join(HOME, '.dotnet', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet'), args: ['--version'] }] },
    note: 'Builds DocaDesk. Its WinUI app builds on Windows only; on Linux and macOS its Core and MCP libraries do.',
    repo: 'https://dotnet.microsoft.com/download/dotnet/9.0', repoLabel: 'dotnet.microsoft.com',
    install: { linux: DOTNET_POSIX, darwin: DOTNET_POSIX, win32: winget('Microsoft.DotNet.SDK.9') } },
];

/** The command for this OS, or null. */
function installFor(t, platform = process.platform) {
  const i = t.install || {};
  return i[platform] || (platform !== 'win32' ? i.all : null) || null;
}

/** A version number out of a tool's first line ("Docker version 29.5.3, build …" → 29.5.3); the line when there is none. */
function versionOf(t, line) {
  if (!line) return null;
  const own = t.version && t.version.exec(line);
  if (own) return own[1];
  const m = /(?:^|[^\d.])v?(\d+\.\d+(?:\.\d+)*(?:[-+][\w.]+)?)/.exec(line);
  return m ? m[1] : line.slice(0, 40);
}

module.exports = { SYSTEM_TOOLS, installFor, versionOf };
