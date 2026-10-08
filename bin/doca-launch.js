#!/usr/bin/env node
'use strict';

/**
 * The DOCA launcher, in Node so it runs on Linux, Windows and macOS alike
 * (docs/design/hive.md §7, TODO H1.3/H1.8). It was bash (run.sh), which a
 * Windows host does not have — so there a version switch could not restart
 * the panel and nothing could start it at logon.
 *
 *   node bin/doca-launch.js start     start the panel (the version in .releases/current, else the checkout);
 *                                     --log <file> appends its output there (the Windows entry has no console)
 *   node bin/doca-launch.js enable    start DOCA at boot/logon  (systemd on Linux via run.sh,
 *                                     Task Scheduler on Windows, launchd on macOS)
 *   node bin/doca-launch.js disable   stop starting at boot/logon; a running panel is left alone
 *   node bin/doca-launch.js status    JSON: is the boot entry there
 *
 * `start` does what run.sh's did: the environment from .env, DOCA_HOME and the
 * data paths that outlive a version, dependencies installed once per version,
 * and a version just switched to started **watched** — if it dies or stays
 * silent for 90 s, the previous one is put back and started. The check lives
 * here, outside the new version, because that is exactly the code that cannot
 * be trusted to judge itself.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

const DIR = path.resolve(process.env.DOCA_LAUNCH_DIR || path.join(__dirname, '..'));
const RELEASES = path.join(DIR, '.releases');
const WATCH_SECONDS = Number(process.env.DOCA_LAUNCH_WATCH_SECONDS) || 90;
const winTask = require('./lib/windows-task'); // Windows Task Scheduler entry
const TASK = winTask.TASK;
const LABEL = 'tech.doca.panel';             // macOS launchd label
const say = (...a) => console.log(...a);

/** KEY=VALUE lines, as `set -a; . .env` read them: comments and blanks skipped, quotes taken off. */
function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    const quoted = /^(["'])(.*?)\1(\s+#.*)?$/.exec(v);
    v = quoted ? quoted[2] : v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

/** The version to start: the tag in .releases/current if it is installed, else the checkout. */
function releaseDir(dir = DIR) {
  let tag = '';
  try { tag = fs.readFileSync(path.join(dir, '.releases', 'current'), 'utf8').trim(); } catch {}
  if (tag && fs.existsSync(path.join(dir, '.releases', tag, 'server.js'))) return path.join(dir, '.releases', tag);
  return dir;
}

function releaseLog(event, to, from) {
  try { fs.appendFileSync(path.join(RELEASES, 'log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), event, to, from, by: 'launcher' })}\n`); } catch {}
}

/** Does the panel answer on / ? HTTPS first (self-signed), then plain HTTP. */
function answers(port = process.env.PORT || 4242) {
  const ask = mod => new Promise(resolve => {
    const req = mod.get({ host: '127.0.0.1', port, path: '/', rejectUnauthorized: false, timeout: 4000 }, r => { r.resume(); resolve(r.statusCode < 500); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
  return ask(https).then(ok => ok || ask(http));
}

function environment() {
  try { Object.assign(process.env, parseEnv(fs.readFileSync(path.join(DIR, '.env'), 'utf8'))); } catch {}
  process.env.DOCA_HOME = DIR;
  process.env.DOCA_DATA_DIR ||= path.join(DIR, '.doca');
  process.env.DOCA_PREFS_FILE ||= path.join(DIR, '.dashboard-prefs.json');
}

function installDeps(app) {
  if (fs.existsSync(path.join(app, 'node_modules'))) return;
  say(`Installing dependencies in ${app}…`);
  // npm is npm.cmd on Windows, which only a shell runs.
  const r = spawnSync('npm', ['install', '--omit=dev'], { cwd: app, stdio: logFd === null ? 'inherit' : ['ignore', logFd, logFd], shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`npm install failed in ${app}`);
}

/**
 * `start --log <file>`: the launcher's and the panel's output appended to a file. The Task Scheduler entry starts DOCA
 * with no console anyone sees (bin/lib/windows-task.js), so without it what DOCA said at sign-in went nowhere.
 */
let logFd = null;
function logTo(file) {
  logFd = fs.openSync(file, 'a');
  for (const k of ['log', 'error']) console[k] = (...a) => fs.writeSync(logFd, `${a.join(' ')}\n`);
}

/** Run server.js in `app`; resolves with its exit code. Stops are passed on, never orphaning it. */
function runServer(app, { onStop } = {}) {
  const child = spawn(process.execPath, ['server.js'], { cwd: app, stdio: logFd === null ? 'inherit' : ['ignore', logFd, logFd], env: process.env });
  const stop = () => { onStop?.(); child.kill('SIGTERM'); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const done = new Promise(resolve => child.on('exit', (code, signal) => {
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
    resolve(code ?? (signal ? 0 : 1));
  }));
  return { child, done };
}

async function start() {
  environment();
  const app = releaseDir();
  installDeps(app);
  const pending = path.join(RELEASES, 'pending');
  if (!fs.existsSync(pending)) {
    const { done } = runServer(app);
    process.exit(await done);
  }
  // A version just switched to runs watched until it answers.
  const [to, from] = fs.readFileSync(pending, 'utf8').trim().split(/\s+/);
  let stopping = false, exited = null;
  const { child, done } = runServer(app, { onStop: () => { stopping = true; } });
  done.then(code => { exited = code; });
  for (let waited = 0; waited < WATCH_SECONDS && !stopping && exited === null; waited += 3) {
    if (await answers()) {
      fs.rmSync(pending, { force: true });
      releaseLog('confirm', to, from);
      say(`✓ ${to} answers — keeping it.`);
      process.exit(await done);
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  if (exited === null) { child.kill('SIGTERM'); await done; }
  if (stopping) process.exit(0);   // being stopped is not the new version failing
  if (from === 'checkout') fs.rmSync(path.join(RELEASES, 'current'), { force: true });
  else fs.writeFileSync(path.join(RELEASES, 'current'), `${from}\n`);
  fs.rmSync(pending, { force: true });
  releaseLog('revert', from, to);
  console.error(`✗ ${to} did not answer within ${WATCH_SECONDS} s — switched back to ${from}.`);
  return start();
}

/* ── Start at boot / logon, per OS ─────────────────────── */

function launchCommand() { return [process.execPath, path.join(DIR, 'bin', 'doca-launch.js'), 'start']; }


/** The launchd agent (macOS): started at login, output to restart.log, in the checkout. */
function launchdPlist() {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const log = path.join(DIR, 'restart.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>${launchCommand().map(a => `<string>${esc(a)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${esc(DIR)}</string>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${esc(log)}</string>
  <key>StandardErrorPath</key><string>${esc(log)}</string>
</dict>
</plist>
`;
}
const plistPath = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

function boot(verb) {
  if (process.platform === 'linux') {
    if (verb === 'status') return { method: 'systemd', ...sh('systemctl', ['is-enabled', 'openclaw-panel.service']) };
    const r = spawnSync('bash', [path.join(DIR, 'run.sh'), verb], { stdio: 'inherit' });
    return { method: 'systemd', ok: r.status === 0 };
  }
  if (process.platform === 'win32') {
    const [node, script] = launchCommand(), entry = { node, script, dir: DIR };
    if (verb === 'enable') { const r = winTask.enable(entry); say(r.ok ? `✓ DOCA will start when you sign in to Windows (Task Scheduler: ${TASK}).` : r.out); return { method: 'Task Scheduler', ...r }; }
    if (verb === 'disable') { const r = winTask.disable(entry); say(r.ok ? '✓ DOCA will no longer start at sign-in.' : r.out); return { method: 'Task Scheduler', ...r }; }
    return { method: 'Task Scheduler', ...winTask.status(entry) };
  }
  if (process.platform === 'darwin') {
    const p = plistPath();
    if (verb === 'enable') {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, launchdPlist());
      const r = sh('launchctl', ['load', '-w', p]);
      say(r.ok ? `✓ DOCA will start when you log in (launchd: ${LABEL}).` : r.out);
      return { method: 'launchd', ...r };
    }
    if (verb === 'disable') {
      const r = sh('launchctl', ['unload', '-w', p]);
      fs.rmSync(p, { force: true });
      say('✓ DOCA will no longer start at login.');
      return { method: 'launchd', ok: true, out: r.out };
    }
    return { method: 'launchd', ok: fs.existsSync(p), out: p };
  }
  return { method: null, ok: false, out: `no boot manager known for ${process.platform}` };
}

module.exports = { parseEnv, releaseDir, launchdPlist, launchCommand, TASK, LABEL };

if (require.main === module) {
  const verb = process.argv[2] || 'start';
  const at = process.argv.indexOf('--log');
  if (verb === 'start' && at > 0 && process.argv[at + 1]) logTo(process.argv[at + 1]);
  if (verb === 'start') start().catch(e => { console.error(`✗ ${e.message}`); process.exit(1); });
  else if (['enable', 'disable'].includes(verb)) process.exit(boot(verb).ok ? 0 : 1);
  else if (verb === 'status') { console.log(JSON.stringify(boot('status'))); }
  else { console.error('usage: doca-launch.js [start|enable|disable|status]'); process.exit(2); }
}
