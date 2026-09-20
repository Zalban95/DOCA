'use strict';

/**
 * The shell this machine actually has.
 *
 * Everything that ran a command line in this panel hardcoded bash — `exec(…,
 * {shell: '/bin/bash'})` for the agent's `shell` tool, `spawn('bash', ['-lc'])`
 * for every streamed installer, `bash -lc "which …"` for binary detection. On
 * Windows all of it fails with ENOENT, which is not a graceful degradation:
 * the agent's single most-used tool returns `exit ENOENT` for every call it
 * ever makes.
 *
 * So the interpreter is a fact about the host, decided in one place. Linux and
 * macOS keep bash (or `$SHELL`). Windows gets PowerShell, which is present on
 * every supported version, is what the agent's own Windows knowledge assumes,
 * and unlike `cmd.exe` can express the things a command line is usually for.
 *
 * Two things callers must not re-derive:
 *
 * **The flag is not `-c` everywhere.** PowerShell takes `-Command`, and Node's
 * own `{shell}` option would hand it `/d /s /c`, which PowerShell reads as a
 * path. So a command line is run through `execFile` with this module's argv,
 * never through `exec`'s shell option.
 *
 * **A command written for one shell does not run on the other.** This module
 * makes the host's shell reachable; it does not translate. `environment.js`
 * tells the agent which shell it has, and that is the honest fix — a
 * translation layer would be a new dialect that is subtly neither.
 */
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const WIN = process.platform === 'win32';

/**
 * How to invoke the host's shell with a command line.
 *
 * `-NoProfile` because a profile that prints a banner corrupts the first lines
 * of every command's output, and `-NonInteractive` because nothing here can
 * answer a prompt — a shell that stops to ask blocks until the timeout kills
 * it, with no clue as to why.
 */
function spec() {
  if (WIN) {
    return {
      name:  'powershell',
      file:  process.env.DOCA_SHELL || 'powershell.exe',
      args:  ['-NoProfile', '-NonInteractive', '-Command'],
      label: 'PowerShell',
    };
  }
  const file = process.env.DOCA_SHELL || process.env.SHELL || '/bin/bash';
  return { name: path.basename(file), file, args: ['-lc'], label: path.basename(file) };
}

/** The one sentence the agent is told about what it is typing into. */
function describe() {
  const s = spec();
  return WIN
    ? `${s.label} on Windows — PowerShell syntax, not bash. No \`&&\`; use \`;\` or separate calls. `
      + 'Paths use backslashes and drive letters.'
    : `${s.label} on ${process.platform} — POSIX shell syntax.`;
}

/**
 * Run a command line and collect its output.
 *
 * Resolves `{ code, out, timedOut, error }` and never rejects: a failed
 * command is a result the agent reads and corrects itself from, not an
 * exception that kills a turn.
 */
function run(command, { cwd, timeout = 60000, maxBuffer = 4 << 20, env, signal } = {}) {
  const s = spec();
  return new Promise(resolve => {
    execFile(s.file, [...s.args, command], {
      cwd, timeout, maxBuffer, signal, windowsHide: true,
      env: env ? { ...process.env, ...env } : process.env,
    }, (err, stdout, stderr) => {
      const out = [stdout, stderr].filter(t => t && String(t).trim()).join('\n').trim();
      resolve({
        out,
        // `killed` is how Node reports the timeout it enforced, which is a
        // different thing from the command exiting non-zero.
        timedOut: !!(err && err.killed),
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        // ENOENT here means the shell itself is missing, not the command —
        // worth saying plainly, because it is the one failure no amount of
        // rewriting the command will fix.
        error: err && err.code === 'ENOENT' ? `${s.file} was not found on this host` : null,
      });
    });
  });
}

/** Spawn the host shell on a command line, for callers that stream output. */
function spawnShell(command, opts = {}) {
  const s = spec();
  return spawn(s.file, [...s.args, command], { windowsHide: true, ...opts });
}

/**
 * Find an executable, without asking a shell to do it.
 *
 * This was `bash -lc "which x"` with four `test -f` fallbacks and a `find`
 * through `~/.nvm` — none of which exists on Windows, where the answer also
 * has to consider PATHEXT (`x.cmd` and `x.exe` are `x`). Walking PATH in
 * process is shorter, works on both, and cannot hang on a login shell that
 * sources somebody's half-broken profile.
 */
function which(cmd) {
  if (!cmd || /[\\/]/.test(cmd)) return null;
  const fs = require('fs');
  const exts = WIN
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const home = os.homedir();
  // The directories a user's tools actually land in, which a non-login process
  // does not necessarily inherit.
  const extra = WIN ? [] : [
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/local/bin',
  ];
  for (const dir of [...(process.env.PATH || '').split(path.delimiter), ...extra]) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      try {
        const st = fs.statSync(full);
        if (st.isFile()) return full;
      } catch { /* not here */ }
    }
  }
  return null;
}

module.exports = { WIN, spec, describe, run, spawnShell, which };
