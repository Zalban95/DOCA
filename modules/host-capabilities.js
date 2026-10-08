'use strict';

/**
 * What this host can do, probed rather than assumed (docs/design/hive.md §7,
 * TODO H1.2): the platform runs on Linux, Windows and macOS up to the
 * hardware, so a capability that is absent is reported with what would supply
 * it, and the panel greys it out instead of failing in its name.
 *
 * Only PATH lookups and file checks — no subprocess — so it is cheap enough to
 * draw on every visit; cached for a minute anyway. A row is
 * `{ available, via, note }`: `via` names what was found, `note` what to
 * install when nothing was.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const shell = require('./shell');

const PLATFORM = { linux: 'Linux', win32: 'Windows', darwin: 'macOS' };
let _cache = null;

const found = (via, extra = {}) => ({ available: true, via, ...extra });
const absent = note => ({ available: false, via: null, note });
const firstBin = names => names.find(n => shell.which(n)) || null;
const firstFile = files => files.find(f => { try { return fs.existsSync(f); } catch { return false; } }) || null;

function boot() {
  if (process.platform === 'linux') return shell.which('systemctl') && require('./systemd').running() ? found('systemd') : absent('no systemd on this host');
  if (process.platform === 'win32') return found('Task Scheduler', { note: 'an entry at sign-in (bin/doca-launch.js enable)' });
  if (process.platform === 'darwin') return found('launchd', { note: 'a launch agent (bin/doca-launch.js enable)' });
  return absent(`no known boot manager on ${process.platform}`);
}

function gpu() {
  const via = firstBin(['nvidia-smi', 'rocm-smi', 'xpu-smi']);
  if (via) return found(via, { readings: via !== 'xpu-smi' });
  if (process.platform === 'darwin' && os.arch() === 'arm64') return { available: true, via: 'Apple GPU (unified memory)', readings: true, note: 'utilisation and memory in use, from ioreg' };
  return absent('no GPU tool found (nvidia-smi, rocm-smi, xpu-smi); inference still runs on the CPU');
}

/** A Chromium Playwright downloaded (its cache on each OS), which a CDP-driven browser can use as well. */
function playwrightChromium() {
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || {
    win32: path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
    darwin: path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
  }[process.platform] || path.join(os.homedir(), '.cache', 'ms-playwright');
  let dirs = [];
  try { dirs = fs.readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort().reverse(); } catch { return null; }
  for (const d of dirs) {
    const hit = firstFile(['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-win/chrome.exe', 'chrome-win64/chrome.exe',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'].map(f => path.join(cache, d, f)));
    if (hit) return hit;
  }
  return null;
}

function browser() {
  const files = {
    win32: [path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  }[process.platform] || [];
  const via = firstBin(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) || firstFile(files) || playwrightChromium();
  return via ? found(via) : absent('no Chrome, Chromium or Edge found — the agent\'s browser (TODO H5) needs one');
}

function collect() {
  return {
    os: { platform: process.platform, name: PLATFORM[process.platform] || process.platform, release: os.release(), arch: os.arch(),
      cpus: os.cpus().length, memoryGB: Math.round(os.totalmem() / 2 ** 30) },
    node: process.version,
    shell: found(shell.spec().name),
    boot: boot(),
    gpu: gpu(),
    containers: (v => (v ? found(v) : absent('no Docker or Podman — services and sandboxes need one')))(firstBin(['docker', 'podman'])),
    vms: (v => (v ? found(v) : absent('no hypervisor found (virsh, VBoxManage, Hyper-V, utmctl)')))(firstBin(['virsh', 'VBoxManage', 'utmctl'])
      || (process.platform === 'win32' && firstFile([path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'vmms.exe')]) ? 'Hyper-V' : null)),
    browser: browser(),
    inference: (v => (v.length ? found(v.join(', ')) : absent('no local runtime found (llama-server, ollama); a remote provider still works')))(
      ['llama-server', 'ollama'].filter(b => shell.which(b))),
    git: shell.which('git') ? found('git') : absent('git is needed for projects and checkpoints'),
    python: (v => (v ? found(v) : absent('no Python — project venvs and HuggingFace need one')))(firstBin(['python3', 'python', 'py'])),
    tailscale: shell.which('tailscale') ? found('tailscale') : absent('no tailscale CLI; DOCA still listens on loopback'),
  };
}

function capabilities({ fresh = false } = {}) {
  if (!fresh && _cache && Date.now() - _cache.at < 60e3) return _cache.value;
  _cache = { at: Date.now(), value: collect() };
  return _cache.value;
}

module.exports = { capabilities };
