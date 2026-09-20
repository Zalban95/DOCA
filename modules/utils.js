'use strict';

const { exec, execFile } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const shell = require('./shell');

const { COMPOSE_DIR, CONFIG_PATH, PREFS_FILE, FM_ALLOWED_ROOTS } = require('./paths');

/** Run a shell command and return { stdout, stderr }. Rejects on non-zero exit. */
function run(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: cwd || COMPOSE_DIR, timeout: 60000 }, (err, stdout, stderr) => {
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

/** Return true if the resolved path falls within an allowed root. */
function fmSafe(p) {
  const abs = path.resolve(p);
  // `root + '/'` was a Unix assumption, and the machine this is developed on is
  // Windows: every absolute path there is separated by `\`, so nothing but a root
  // itself ever passed and the file tools refused the whole disk. Compare with
  // the platform's separator, and case-insensitively where the filesystem is.
  const fold = s => (process.platform === 'win32' ? s.toLowerCase() : s);
  return FM_ALLOWED_ROOTS.some(rootRaw => {
    const root = fold(path.resolve(rootRaw)), a = fold(abs);
    return a === root || a.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  });
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
  return loadPrefs().models || {};
}

/** Save the models sub-object into prefs. */
function saveModelsPrefs(models) {
  const prefs = loadPrefs();
  prefs.models = models;
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
