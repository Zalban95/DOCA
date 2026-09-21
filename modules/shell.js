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
const fs = require('fs');
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
function spec({ interactive = false } = {}) {
  if (WIN) {
    return {
      name:  'powershell',
      file:  process.env.DOCA_SHELL || 'powershell.exe',
      args:  ['-NoProfile', '-NonInteractive', '-Command'],
      label: 'PowerShell',
    };
  }

  // A person's prompt gets their own shell; a script we wrote does not.
  //
  // v2.49.0 pointed *everything* at `$SHELL`, which broke detection and every
  // installer on any host whose login shell is not bash: the strings in
  // `system-tools.js` and `catalog.js` are bash — `2>/dev/null`,
  // `test -f x && { …; }` — and fish and tcsh do not read them. The original
  // code hardcoded `bash` for exactly this reason, and losing that was a
  // regression, not a simplification.
  //
  // So `$SHELL` is honoured only where the user is the one typing (the
  // Terminal tab). Everything scripted gets a shell whose syntax we know.
  if (interactive) {
    const file = process.env.DOCA_SHELL || process.env.SHELL || '/bin/bash';
    return { name: path.basename(file), file, args: ['-lc'], label: path.basename(file), interactive: true };
  }
  if (process.env.DOCA_SHELL)
    return { name: path.basename(process.env.DOCA_SHELL), file: process.env.DOCA_SHELL, args: ['-lc'], label: path.basename(process.env.DOCA_SHELL) };
  for (const file of ['/bin/bash', '/usr/bin/bash'])
    if (fs.existsSync(file)) return { name: 'bash', file, args: ['-lc'], label: 'bash' };
  // No bash at all (Alpine, a minimal container). `-c`, not `-lc`: `-l` is not
  // a POSIX `sh` option and dash treats it inconsistently.
  return { name: 'sh', file: '/bin/sh', args: ['-c'], label: 'sh' };
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
        // Kept apart as well as combined. `out` is right for a human reading a
        // command's output, and wrong for parsing: a detector that reads a
        // version off `out` picks up a warning on stderr or a login shell's
        // banner and reports it as the version. Callers that parse take this.
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim(),
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
