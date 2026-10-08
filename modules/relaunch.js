'use strict';

/**
 * DOCA started again by the install's launcher, detached so it outlives the process that asks — the one way both a
 * restart (modules/update.js) and a version switch (modules/releases.js) hand over when nothing supervises the panel.
 *
 * Run on a real Windows 11 host (H1.9, 2026-10-08) the two had drifted apart and both broke there:
 *   - Restart ran `bash run.sh start`. Windows has no bash; the bash.exe it found was WSL's launcher, which with no Linux
 *     installed prints an error and exits (and with one would start run.sh inside Linux). DOCA stopped and never came
 *     back. run.sh start is `exec node bin/doca-launch.js start`, so the launcher is called directly, on every OS.
 *   - A switch's launcher had no console, so the server it started got a new one: with Windows Terminal as the default
 *     console a terminal window titled node.exe opened on the desktop, and closing it stops DOCA. The launcher now
 *     starts the server with windowsHide (which in libuv also means CREATE_NO_WINDOW: a console nobody can show), so
 *     this stays a plain detached, hidden node on every OS. (conhost --headless, which hides the sign-in entry, exits
 *     at once without running anything when Node spawns it — tried.)
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/** The command that starts DOCA again: the install's launcher, run by this node. */
function command({ home, node = process.execPath }) {
  return { file: node, args: [path.join(home, 'bin', 'doca-launch.js'), 'start'] };
}

/** Start it, detached and hidden, its output appended to `log`; the caller exits after. Returns the child (its pid is the handoff). */
function relaunch({ log, home = process.env.DOCA_HOME || path.join(__dirname, '..') } = {}) {
  const c = command({ home });
  const out = fs.openSync(log, 'a');
  const child = spawn(c.file, c.args, { cwd: home, detached: true, stdio: ['ignore', out, out], env: process.env, windowsHide: true });
  child.unref();
  return child;
}

module.exports = { command, relaunch };
