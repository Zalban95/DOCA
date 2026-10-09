'use strict';

const { exec, execFile } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const shell = require('./shell');

const { COMPOSE_DIR, CONFIG_PATH, PREFS_FILE, FM_ALLOWED_ROOTS, PROTECTED_FILES, PROTECTED_DIRS } = require('./paths');

/** Run a shell command and return { stdout, stderr }. Rejects on non-zero exit. */
function run(cmd, cwd) {
  if (require('./hosted').on()) return Promise.reject({ error: require('./hosted').refusal('A command line on the hub').message, stderr: '', stdout: '' });   // hosted.js
  // The compose folder only when it is there: on an install without OpenClaw it is not, and a missing
  // working directory made every command fail at once — docker ps, nvidia-smi, curl — so the sidebar
  // said "None running" and "No GPU data" on a machine with both (found 2026-09-27).
  const dir = cwd || (require('fs').existsSync(COMPOSE_DIR) ? COMPOSE_DIR : require('os').homedir());
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: dir, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject({ error: err.message, stderr, stdout });
      else resolve({ stdout, stderr });
    });
  });
}

/** Expand `${VAR}` references in a config string from process.env. */
function resolveEnvVars(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '');
}

/** Set standard SSE headers on an Express response. */
function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

/** Return true if the resolved path falls within an allowed root, and is not a protected file. */
/**
 * A path as the filesystem will really reach it: symlinks resolved, and for a
 * file not made yet, its nearest existing parent's real path with the rest kept.
 */
function realOf(abs) {
  let base = abs, rest = '';
  for (;;) {
    // .native: the OS's own answer, which on Windows also expands 8.3 short names (C:\\Users\\RUNNER~1 → runneradmin)
    // so a temp path and the home folder compare as the same place.
    try { return path.join(fs.realpathSync.native(base), rest); } catch { /* not there yet */ }
    const up = path.dirname(base);
    if (up === base) return abs;
    rest = rest ? path.join(path.basename(base), rest) : path.basename(base);
    base = up;
  }
}

function fmSafe(p) {
  const abs = path.resolve(p);
  // By its real path too: a symlink made to a protected file is the same file, and a symlink inside an
  // allowed folder pointing outside it reaches outside it (audit 2026-10-04) — so both must be inside.
  const real = realOf(abs);
  // The protected file by its real path as well: on macOS /var is /private/var and on Windows a path can name a
  // folder by its 8.3 short name, so a link to the prefs file compared unequal and was written through (CI on
  // macOS/Windows, 2026-10-04). Case-insensitively where the filesystem is.
  const same = (x, y) => (process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y);
  if (require('./hosted').inApp(real) || require('./hosted').inApp(abs)) return false;   // a hosted hive's code is never opened (hosted.js)
  if (require('./edition-mode').inCode(real) || require('./edition-mode').inCode(abs)) return false;   // nor a production hive's (edition-mode.js)
  if (PROTECTED_FILES.some(f => { const r = path.resolve(f), rr = realOf(r); return [r, rr].some(p => same(p, abs) || same(p, real)); })) return false;
  const under = (x, d) => same(x, d) || (process.platform === 'win32' ? x.toLowerCase().startsWith(d.toLowerCase() + path.sep) : x.startsWith(d + path.sep));
  if ((PROTECTED_DIRS || []).some(d => { const r = path.resolve(d), rr = realOf(r); return [r, rr].some(p => under(abs, p) || under(real, p)); })) return false;
  // `root + '/'` was a Unix assumption, and the machine this is developed on is
  // Windows: every absolute path there is separated by `\`, so nothing but a root
  // itself ever passed and the file tools refused the whole disk. Compare with
  // the platform's separator, and case-insensitively where the filesystem is.
  const fold = s => (process.platform === 'win32' ? s.toLowerCase() : s);
  const inside = target => FM_ALLOWED_ROOTS.some(rootRaw => {
    const root = fold(realOf(path.resolve(rootRaw))), a = fold(target);
    return a === root || a.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  });
  return inside(real);   // roots by their real path too: /tmp is a symlink on some systems
}

/** Load dashboard preferences from disk (returns {} on missing/corrupt file). */
function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); }
  catch { return {}; }
}

/** Persist dashboard preferences to disk. */
function savePrefs(data) {
  // DOCA_PREFS_FILE can point anywhere, including a directory nobody made yet.
  fs.mkdirSync(path.dirname(PREFS_FILE), { recursive: true });
  if (!fs.existsSync(PREFS_FILE)) data = require('./migrations').stamp(data);   // a new file has had every migration
  else require('./checkpoints').keep(PREFS_FILE, data);   // what it replaces stays, to look at and restore (checkpoints.js)
  fs.writeFileSync(PREFS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Read the OpenClaw config JSON.
 *
 * A file that is not there yet reads as `{}` so callers can write the first
 * provider into a fresh install instead of failing. A file that exists but does
 * not parse still throws: silently starting from `{}` there would drop
 * everything in it on the next save.
 */
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
}

/**
 * Write a text file the way every editor in this dashboard should: create the
 * directory if the tree does not exist yet, and keep the previous version
 * alongside it as `<name>.bak` when there was one.
 */
function writeFileSafe(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, filePath + '.bak');
  fs.writeFileSync(filePath, content, 'utf8');
}

/** Write the OpenClaw config JSON. */
function saveConfig(cfg) {
  writeFileSafe(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

/** Load the models sub-object from prefs. */
function loadModelsPrefs() {
  const models = loadPrefs().models || {};
  const token = require('./hf-token').get();   // the token lives in the protected keys (hf-token.js), not in prefs
  return token ? { ...models, hf: { ...(models.hf || {}), token } } : models;
}

/** Save the models sub-object into prefs — its Hugging Face token into the protected keys instead. */
function saveModelsPrefs(models) {
  const prefs = loadPrefs();
  const { token, ...hf } = models?.hf || {};
  if (models?.hf) require('./hf-token').set(token);
  prefs.models = models?.hf ? { ...models, hf } : models;
  savePrefs(prefs);
}

/**
 * Run a shell command and stream its output to the client as SSE.
 * Shared install/command runner used by system-tools, the harness catalog,
 * models-local and models tool installs.
 *
 * Emits `{status}` chunks and a final `{done, ok, status}` event.
 *
 * Sudo handling: when `password` is provided, a short-lived 0700 askpass
 * helper is created and every `sudo` in the command is rewritten to
 * `sudo -A`. Unlike piping the password to stdin (which only feeds the
 * FIRST sudo — Ubuntu's default `timestamp_type=tty` cannot cache
 * credentials in TTY-less sessions, so chained `sudo x && sudo y`
 * commands failed with "Authentication required but not attempted"),
 * askpass supplies the password to EVERY sudo invocation, including ones
 * inside install scripts. The helper file is removed when the command ends.
 *
 * @param {import('express').Response} res
 * @param {string} cmd - a command line in the host shell's syntax
 * @param {{ label?: string, cwd?: string, env?: object, password?: string }} [opts]
 */
function streamCmd(res, cmd, opts = {}) {
  const { label, cwd, env, password } = opts;

  sseHeaders(res);
  const sseWrite = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  const home = process.env.HOME || os.homedir();
  let runCmd = cmd;
  const extraEnv = {};
  let askpassFile = null;

  // sudo is a POSIX idea. On Windows there is nothing to hand a password to —
  // elevation is a UAC prompt on the desktop, which this process cannot answer
  // — so the askpass helper is simply not built, rather than writing a .sh
  // nothing will run.
  const needsSudo = !shell.WIN && typeof password === 'string' && password.length > 0;
  if (needsSudo) {
    // POSIX-safe single-quote escaping for the password embedded in the helper.
    const quoted = `'${password.replace(/'/g, `'\\''`)}'`;
    askpassFile = path.join(os.tmpdir(),
      `.doca-askpass-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.sh`);
    fs.writeFileSync(askpassFile, `#!/bin/sh\nprintf '%s\\n' ${quoted}\n`, { mode: 0o700 });
    extraEnv.SUDO_ASKPASS = askpassFile;
    runCmd = cmd.replace(/\bsudo\b(?!\s+-A)/g, 'sudo -A');
  }
  const cleanupAskpass = () => {
    if (!askpassFile) return;
    try { fs.rmSync(askpassFile, { force: true }); } catch {}
    askpassFile = null;
  };

  sseWrite({ status: `${label ? `Installing ${label}…\n` : ''}$ ${cmd}\n` });

  // The host's own shell, and its own PATH separator. This used to be
  // `spawn('bash', ['-lc'])` with a PATH joined by ':' — on Windows the shell
  // does not exist, and the PATH it was handed would have been unusable if it
  // had.
  const child = shell.spawnShell(runCmd, {
    cwd:   cwd || home,
    env:   {
      ...process.env,
      ...env,
      ...extraEnv,
      HOME: home,
      DEBIAN_FRONTEND: 'noninteractive',
      PATH: [
        ...(shell.WIN ? [] : [path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin')]),
        process.env.PATH || '',
      ].filter(Boolean).join(path.delimiter),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', d => sseWrite({ status: d.toString() }));
  child.stderr.on('data', d => sseWrite({ status: d.toString() }));
  child.on('close', (code, signal) => {
    cleanupAskpass();
    const ok  = code === 0;
    const msg = ok ? '✓ Done'
      : code !== null ? `✗ Exit ${code}`
      : `✗ Killed by signal (${signal || 'unknown'})`;
    sseWrite({ done: true, ok, error: !ok, status: msg });
    res.end();
  });
  child.on('error', e => {
    cleanupAskpass();
    sseWrite({ done: true, ok: false, error: true, status: `Error: ${e.message}` });
    res.end();
  });
  res.on('close', () => { cleanupAskpass(); if (!child.killed) child.kill(); });
}

/**
 * Locate a binary across PATH and common user-install locations
 * (login-shell which, ~/.npm-global/bin, ~/.local/bin, /usr/local/bin,
 * nvm-managed node versions) and best-effort read its version.
 *
 * @param {string} cmd - binary name
 * @returns {Promise<{ detected: boolean, path: string|null, version: string|null }>}
 */
function detectBinary(cmd) {
  // PATH is walked in process rather than through `bash -lc which` and four
  // `test -f` fallbacks: none of that exists on Windows, where the answer also
  // has to consider PATHEXT, and a login shell can hang on somebody's profile.
  const bin = shell.which(cmd);
  if (!bin) return Promise.resolve({ detected: false, path: null, version: null });

  return new Promise(resolve => {
    // `--version` then `version`: both are common and neither is universal.
    // execFile on the binary itself, so a path with a space is an argument
    // rather than two words for a shell to misread.
    execFile(bin, ['--version'], { timeout: 3000, windowsHide: true }, (err, out) => {
      const first = t => String(t || '').trim().split('\n')[0].slice(0, 60) || null;
      if (!err && first(out)) return resolve({ detected: true, path: bin, version: first(out) });
      execFile(bin, ['version'], { timeout: 3000, windowsHide: true }, (e2, out2) =>
        resolve({ detected: true, path: bin, version: e2 ? null : first(out2) }));
    });
  });
}

module.exports = {
  realOf,
  run,
  resolveEnvVars,
  sseHeaders,
  fmSafe,
  loadPrefs,
  savePrefs,
  loadConfig,
  saveConfig,
  writeFileSafe,
  loadModelsPrefs,
  saveModelsPrefs,
  streamCmd,
  detectBinary,
};
