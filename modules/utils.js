'use strict';

const { exec, execSync, spawn } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { COMPOSE_DIR, PREFS_FILE, FM_ALLOWED_ROOTS } = require('./paths');

/** Run a shell command and return { stdout, stderr }. Rejects on non-zero exit. */
function run(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: cwd || COMPOSE_DIR, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject({ error: err.message, stderr, stdout });
      else resolve({ stdout, stderr });
    });
  });
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
  return FM_ALLOWED_ROOTS.some(root => abs === root || abs.startsWith(root + '/'));
}

/** Load dashboard preferences from disk (returns {} on missing/corrupt file). */
function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); }
  catch { return {}; }
}

/** Persist dashboard preferences to disk. */
function savePrefs(data) {
  fs.writeFileSync(PREFS_FILE, JSON.stringify(data, null, 2), 'utf8');
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
 * Shared install/command runner used by system-tools, code-tools,
 * models-local and models tool installs.
 *
 * Emits `{status}` chunks and a final `{done, ok, status}` event.
 * Supports sudo password piping: when `password` is provided and the
 * command uses sudo, it is rewritten to `sudo -S` and the password is
 * written to stdin (credentials are primed first with `sudo -S -v` so
 * scripts that call sudo internally also work).
 *
 * @param {import('express').Response} res
 * @param {string} cmd - bash command line
 * @param {{ label?: string, cwd?: string, env?: object, password?: string }} [opts]
 */
function streamCmd(res, cmd, opts = {}) {
  const { label, cwd, env, password } = opts;

  sseHeaders(res);
  const sseWrite = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  const home = process.env.HOME || os.homedir();
  let runCmd = cmd;
  const needsSudo = typeof password === 'string' && password.length > 0;
  if (needsSudo) {
    // Prime sudo credentials so both explicit `sudo` in the command and
    // sudo calls inside install scripts reuse the cached credential.
    runCmd = `sudo -S -v && ${cmd.replace(/\bsudo\b(?! -S)/g, 'sudo -S')}`;
  }

  sseWrite({ status: `${label ? `Installing ${label}…\n` : ''}$ ${cmd}\n` });

  const child = spawn('bash', ['-lc', runCmd], {
    cwd:   cwd || home,
    env:   {
      ...process.env,
      ...env,
      HOME: home,
      DEBIAN_FRONTEND: 'noninteractive',
      PATH: `${home}/.local/bin:${home}/.npm-global/bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
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
    const msg = ok ? '✓ Done'
      : code !== null ? `✗ Exit ${code}`
      : `✗ Killed by signal (${signal || 'unknown'})`;
    sseWrite({ done: true, ok, error: !ok, status: msg });
    res.end();
  });
  child.on('error', e => {
    sseWrite({ done: true, ok: false, error: true, status: `Error: ${e.message}` });
    res.end();
  });
  res.on('close', () => { if (!child.killed) child.kill(); });
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
  const home = process.env.HOME || os.homedir();
  const detectCmd = [
    `bash -lc "which ${cmd} 2>/dev/null"`,
    `{ test -f "$HOME/.npm-global/bin/${cmd}" && echo "$HOME/.npm-global/bin/${cmd}"; }`,
    `{ test -f "$HOME/.local/bin/${cmd}"      && echo "$HOME/.local/bin/${cmd}"; }`,
    `{ test -f "/usr/local/bin/${cmd}"        && echo "/usr/local/bin/${cmd}"; }`,
    `find "$HOME/.nvm/versions" -name "${cmd}" -type f 2>/dev/null | grep -m1 .`,
  ].join(' || ');

  return new Promise(resolve => {
    exec(detectCmd, { env: { ...process.env, HOME: home }, timeout: 10000 }, (err, stdout) => {
      const bin = (stdout || '').trim().split('\n')[0] || null;
      if (!bin) return resolve({ detected: false, path: null, version: null });
      let version = null;
      try {
        const vOut = execSync(
          `bash -lc "'${bin}' --version 2>/dev/null || '${bin}' version 2>/dev/null"`,
          { timeout: 3000 }
        ).toString().trim();
        version = vOut.split('\n')[0].slice(0, 60) || null;
      } catch {}
      resolve({ detected: true, path: bin, version });
    });
  });
}

module.exports = {
  run,
  sseHeaders,
  fmSafe,
  loadPrefs,
  savePrefs,
  loadModelsPrefs,
  saveModelsPrefs,
  streamCmd,
  detectBinary,
};
