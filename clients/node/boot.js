'use strict';

/**
 * doca-client at boot (TODO H6.7: a server, a Pi, a desktop nobody sits at): `doca-client enable` makes `run` start by
 * itself — a systemd user unit on Linux (with `loginctl enable-linger` it runs with nobody logged in), a launchd agent
 * on macOS, a Task Scheduler entry at sign-in on Windows. `run` with no terminal lends exactly what its person granted
 * the first time (the grants are kept in its config) and asks nothing.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const NAME = 'doca-client', LABEL = 'tech.doca.client', TASK = 'DOCA client';
const script = () => path.join(__dirname, 'doca-client.js');
const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() }; };
const unitPath = () => path.join(os.homedir(), '.config', 'systemd', 'user', `${NAME}.service`);
const plistPath = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

function unit(env = {}) {
  return `[Unit]
Description=DOCA client: this machine lends its tools to the hive
After=network-online.target

[Service]
ExecStart=${process.execPath} ${script()} run
Restart=on-failure
RestartSec=10
${Object.entries(env).map(([k, v]) => `Environment=${k}=${v}`).join('\n')}

[Install]
WantedBy=default.target
`;
}

function plist(env = {}) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const log = path.join(os.homedir(), 'Library', 'Logs', 'doca-client.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${esc(process.execPath)}</string><string>${esc(script())}</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  ${Object.keys(env).length ? `<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => `<key>${esc(k)}</key><string>${esc(v)}</string>`).join('')}</dict>` : ''}
  <key>StandardOutPath</key><string>${esc(log)}</string>
  <key>StandardErrorPath</key><string>${esc(log)}</string>
</dict>
</plist>
`;
}

const schtasks = () => ['/Create', '/TN', TASK, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F', '/TR', `"${process.execPath}" "${script()}" run`];

/** enable | disable | status. `env` carries DOCA_CLIENT_DIR when the config lives somewhere other than the default. */
function boot(verb, { env = process.env.DOCA_CLIENT_DIR ? { DOCA_CLIENT_DIR: process.env.DOCA_CLIENT_DIR } : {} } = {}) {
  if (process.platform === 'linux') {
    if (verb === 'enable') {
      fs.mkdirSync(path.dirname(unitPath()), { recursive: true });
      fs.writeFileSync(unitPath(), unit(env));
      const r = sh('systemctl', ['--user', 'daemon-reload']).ok ? sh('systemctl', ['--user', 'enable', '--now', `${NAME}.service`]) : { ok: false, out: 'systemctl --user is not available here.' };
      return { method: 'systemd (user)', ...r, note: r.ok ? `To run with nobody logged in (a server, a Pi): sudo loginctl enable-linger ${os.userInfo().username}` : '' };
    }
    if (verb === 'disable') { const r = sh('systemctl', ['--user', 'disable', '--now', `${NAME}.service`]); fs.rmSync(unitPath(), { force: true }); return { method: 'systemd (user)', ok: true, out: r.out }; }
    return { method: 'systemd (user)', ...sh('systemctl', ['--user', 'is-enabled', `${NAME}.service`]) };
  }
  if (process.platform === 'darwin') {
    if (verb === 'enable') { fs.mkdirSync(path.dirname(plistPath()), { recursive: true }); fs.writeFileSync(plistPath(), plist(env)); return { method: 'launchd', ...sh('launchctl', ['load', '-w', plistPath()]) }; }
    if (verb === 'disable') { const r = sh('launchctl', ['unload', '-w', plistPath()]); fs.rmSync(plistPath(), { force: true }); return { method: 'launchd', ok: true, out: r.out }; }
    return { method: 'launchd', ok: fs.existsSync(plistPath()), out: plistPath() };
  }
  if (process.platform === 'win32') {
    if (verb === 'enable') return { method: 'Task Scheduler', ...sh('schtasks', schtasks()) };
    if (verb === 'disable') return { method: 'Task Scheduler', ...sh('schtasks', ['/Delete', '/TN', TASK, '/F']) };
    return { method: 'Task Scheduler', ...sh('schtasks', ['/Query', '/TN', TASK]) };
  }
  return { method: null, ok: false, out: `no boot manager known for ${process.platform}` };
}

module.exports = { boot, unit, plist, schtasks, NAME, LABEL, TASK };
