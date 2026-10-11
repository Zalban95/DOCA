'use strict';
/**
 * Where Ollama keeps its models, set from the panel (the owner, 2026-10-11: the Models folder "should tell Ollama where
 * the models are kept" — it used to only tell the Storage card which folder to measure).
 *
 * Ollama reads one setting, OLLAMA_MODELS, from its own environment. So telling it is per OS:
 *   Linux, Ollama as a systemd service  a drop-in `ollama.service.d/20-doca-models.conf` (sudo), the folder given to
 *                                       the unit's user, the service restarted
 *   macOS (the app)                     `launchctl setenv OLLAMA_MODELS`, the app quit and opened again
 *   Windows (the app)                   the user's environment variable, the app stopped and started again
 * The models it has now are copied there first (rsync / robocopy), so none disappear; the old folder is left as it was
 * — removing it is the person's call, once Ollama lists its models from the new one.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DROP_IN = '/etc/systemd/system/ollama.service.d/20-doca-models.conf';
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;   // one POSIX word

/** The folder must be a plain absolute path: no newline or quote that could leave the word it is put in. */
function checkDir(dir) {
  const d = String(dir || '').trim();
  if (!d || !path.isAbsolute(d)) throw Object.assign(new Error('Give the folder as a full path, like /data/ollama.'), { status: 400 });
  if (/[\n\r"`$\\]/.test(d) && process.platform !== 'win32') throw Object.assign(new Error('The folder may not contain quotes, $, ` or \\.'), { status: 400 });
  if (/[\n\r"]/.test(d)) throw Object.assign(new Error('The folder may not contain quotes.'), { status: 400 });
  return path.resolve(d);
}

/** How Ollama runs here, which decides how it is told. */
function how({ platform = process.platform, systemd = () => require('./systemd').running() } = {}) {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  try {
    if (systemd() && require('child_process').execFileSync('systemctl', ['cat', 'ollama'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).length) return 'systemd';
  } catch { /* no unit */ }
  return 'manual';
}

function unitUser() {
  try {
    const out = require('child_process').execFileSync('systemctl', ['show', '-p', 'User', '--value', 'ollama'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    return /^[a-z_][a-z0-9_-]*$/i.test(out) ? out : '';
  } catch { return ''; }
}

/** The command line that tells Ollama, for `kind` (how()). `from` is where its models are now (copied first). */
function commandFor(kind, dir, from, { user = '' } = {}) {
  const copy = from && path.resolve(from) !== path.resolve(dir);
  if (kind === 'systemd') return [
    `sudo mkdir -p ${q(dir)}`,
    copy ? `if [ -d ${q(from)} ]; then sudo rsync -a ${q(from + '/')} ${q(dir + '/')}; fi` : null,
    user ? `sudo chown -R ${user}:${user} ${q(dir)}` : null,
    `sudo mkdir -p ${q(path.dirname(DROP_IN))}`,
    `printf '%s\\n' '[Service]' ${q(`Environment="OLLAMA_MODELS=${dir}"`)} | sudo tee ${DROP_IN} >/dev/null`,
    'sudo systemctl daemon-reload',
    'sudo systemctl restart ollama',
  ].filter(Boolean).join(' && ');
  if (kind === 'macos') return [
    `mkdir -p ${q(dir)}`,
    copy ? `if [ -d ${q(from)} ]; then rsync -a ${q(from + '/')} ${q(dir + '/')}; fi` : null,
    `launchctl setenv OLLAMA_MODELS ${q(dir)}`,
    `(osascript -e 'quit app "Ollama"' || true)`, 'sleep 2', 'open -a Ollama',
  ].filter(Boolean).join(' && ');
  if (kind === 'windows') {
    const ps = s => `'${String(s).replace(/'/g, "''")}'`;
    return [
      `New-Item -ItemType Directory -Force -Path ${ps(dir)} | Out-Null`,
      copy ? `if (Test-Path ${ps(from)}) { robocopy ${ps(from)} ${ps(dir)} /E /NFL /NDL /NJH /NJS | Out-Null }` : null,
      `[Environment]::SetEnvironmentVariable('OLLAMA_MODELS', ${ps(dir)}, 'User')`,
      `Get-Process -Name 'ollama*' -ErrorAction SilentlyContinue | Stop-Process -Force`,
      `Start-Sleep -Seconds 2`,
      `Start-Process (Join-Path $env:LOCALAPPDATA 'Programs\\Ollama\\ollama app.exe')`,
    ].filter(Boolean).join('; ');
  }
  return null;
}

/** Where Ollama keeps its models now, and whether the panel can tell it to keep them elsewhere. */
function state() {
  const home = process.env.HOME || os.homedir();
  const current = require('./models').ollamaModelsDir({}, home);
  const kind = how();
  return { current, how: kind, canSet: kind !== 'manual', needsPassword: kind === 'systemd',
    why: kind === 'manual' ? 'Ollama is not a service here: set OLLAMA_MODELS where you start it.' : null };
}

function mount(app) {
  app.get('/api/models/ollama/home', (_req, res) => { try { res.json(state()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/models/ollama/home', (req, res) => {
    let dir, cmd;
    try {
      dir = checkDir(req.body?.dir);
      const st = state();
      if (!st.canSet) throw Object.assign(new Error(st.why), { status: 409 });
      cmd = commandFor(st.how, dir, st.current, { user: st.how === 'systemd' ? unitUser() : '' });
    } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
    require('./activity').note({ from: 'person', what: `told Ollama to keep its models in ${dir}`, why: 'Field → Models → Ollama — settings' });
    // Ollama now reports the folder itself: the panel's measuring-only setting is cleared so the two never disagree.
    try { const { loadModelsPrefs, saveModelsPrefs } = require('./utils'); const mp = loadModelsPrefs(); if (mp.ollamaPath) { delete mp.ollamaPath; saveModelsPrefs(mp); } } catch { /* the folder is still told */ }
    require('./utils').streamCmd(res, cmd, { label: 'the Ollama models folder', password: req.body?.password });
  });
}

module.exports = { checkDir, how, commandFor, state, mount, DROP_IN };
