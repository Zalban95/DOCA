'use strict';

/**
 * doca-client's families beyond files and shell (TODO H6.6): what a desktop lends when its person says yes — each
 * family asked once, each refused the moment DOCA revokes it, like the first two. Every tool runs a program the OS
 * already has, by argv (never a shell line built from what the agent sent), and says what is missing when it is not:
 *
 *   screen     screen_capture                  macOS screencapture · Windows .NET CopyFromScreen · Linux grim / gnome-screenshot / import / scrot
 *   processes  processes_list, processes_stop  ps · Get-Process · process.kill
 *   apps       apps_open                       open · start · xdg-open — a web address, or a file inside the shared home
 *   device     device_info, device_notify,     os · osascript / notify-send / a Windows balloon
 *              device_clipboard_read/_write    pbpaste·pbcopy / Get-·Set-Clipboard / wl-paste·wl-copy or xclip
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const win = process.platform === 'win32', mac = process.platform === 'darwin';

/** A program by argv: { code, stdout, stderr }; `input` is written to its stdin. ENOENT is code -2. */
function run(cmd, args, { input, env, timeoutMs = 30000 } = {}) {
  return new Promise(resolve => {
    let child;
    try { child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, ...env } }); } catch (e) { return resolve({ code: -2, stdout: '', stderr: e.message }); }
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout = (stdout + d).slice(-200000); }); child.stderr.on('data', d => { stderr = (stderr + d).slice(-20000); });
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', code => { clearTimeout(t); resolve({ code, stdout, stderr }); });
    child.on('error', e => { clearTimeout(t); resolve({ code: e.code === 'ENOENT' ? -2 : -1, stdout, stderr: e.message }); });
    if (input !== undefined) child.stdin.end(String(input)); else child.stdin.end();
  });
}
const ps = (script, env) => run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { env });

/** The first of several programs that is installed and succeeds. */
async function firstOf(tries) {
  const missing = [];
  for (const [cmd, args, opts] of tries) {
    const r = await run(cmd, args, opts);
    if (r.code === -2) { missing.push(cmd); continue; }
    return { ...r, used: cmd };
  }
  return { code: -2, stdout: '', stderr: `none of ${missing.join(', ')} is installed`, used: null };
}

async function capture() {
  const out = path.join(os.tmpdir(), `doca-screen-${process.pid}-${Date.now()}.png`);
  let r;
  if (mac) r = await run('screencapture', ['-x', '-t', 'png', out]);
  else if (win) r = await ps('Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; '
    + '$m=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($m); $g.CopyFromScreen($b.Left,$b.Top,0,0,$m.Size); '
    + '$m.Save($env:DOCA_OUT,[System.Drawing.Imaging.ImageFormat]::Png)', { DOCA_OUT: out });
  else r = await firstOf([['grim', [out]], ['gnome-screenshot', ['-f', out]], ['import', ['-window', 'root', out]], ['scrot', ['-o', out]]]);
  if (!fs.existsSync(out)) throw new Error(`No picture of the screen: ${r.stderr.trim() || `exit ${r.code}`}${!mac && !win ? ' (install grim on Wayland, or ImageMagick / scrot on X11)' : ''}.`);
  const data = fs.readFileSync(out).toString('base64');
  fs.rmSync(out, { force: true });
  return { image: { data, mimeType: 'image/png' }, note: 'the whole screen, now' };
}

async function processes() {
  if (win) {
    const r = await ps('Get-Process | Sort-Object CPU -Descending | Select-Object -First 60 Id,ProcessName,CPU,@{n="MB";e={[int]($_.WorkingSet64/1MB)}} | ConvertTo-Json -Compress');
    return { processes: JSON.parse(r.stdout || '[]') };
  }
  const r = await run('ps', mac ? ['-Ao', 'pid,pcpu,pmem,comm', '-r'] : ['-eo', 'pid,pcpu,pmem,comm', '--sort=-pcpu']);
  return { processes: r.stdout.trim().split('\n').slice(1, 61).map(l => { const [pid, cpu, mem, ...cmd] = l.trim().split(/\s+/); return { pid: Number(pid), cpu: Number(cpu), mem: Number(mem), command: cmd.join(' ') }; }) };
}

function open(cfg, within, target) {
  const t = String(target || '').trim();
  const where = /^(https?:|mailto:)/i.test(t) ? t : within(cfg, t);   // an address, or a file inside the shared home
  if (mac) return run('open', [where]);
  if (win) return run('cmd', ['/c', 'start', '""', where]);
  return run('xdg-open', [where]);
}

async function notify(title, text) {
  if (mac) return run('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', title, text]);
  if (win) return ps('Add-Type -AssemblyName System.Windows.Forms; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; '
    + '$n.Visible=$true; $n.ShowBalloonTip(8000,$env:DOCA_TITLE,$env:DOCA_TEXT,[System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Seconds 9; $n.Dispose()', { DOCA_TITLE: title, DOCA_TEXT: text });
  return run('notify-send', [title, text]);
}

const clipRead = () => (mac ? run('pbpaste', []) : win ? ps('Get-Clipboard -Raw') : firstOf([['wl-paste', ['--no-newline']], ['xclip', ['-selection', 'clipboard', '-o']]]));
const clipWrite = text => (mac ? run('pbcopy', [], { input: text }) : win ? ps('Set-Clipboard -Value $env:DOCA_CLIP', { DOCA_CLIP: text })
  : firstOf([['wl-copy', [], { input: text }], ['xclip', ['-selection', 'clipboard'], { input: text }]]));
const done = (r, what) => { if (r.code !== 0) throw new Error(`${what}: ${(r.stderr || '').trim() || `exit ${r.code}`}`); return { ok: true }; };

module.exports = ({ within }) => ({
  screen_capture: { family: 'screen', description: 'A picture of this machine\'s whole screen, now.', input: {}, run: () => capture() },
  processes_list: { family: 'processes', description: 'The programs running on this machine, busiest first (pid, CPU, memory, name).', input: {}, run: () => processes() },
  processes_stop: { family: 'processes', description: 'Stop a program on this machine by its pid.', input: { pid: 'number' },
    run: (_c, a) => { process.kill(Number(a.pid)); return { ok: true, pid: Number(a.pid) }; } },
  apps_open: { family: 'apps', description: 'Open a web address, or a file in the shared home, with this machine\'s default app.', input: { target: 'string' },
    run: async (c, a) => done(await open(c, within, a.target), 'Could not open it') },
  device_info: { family: 'device', description: 'What this machine is: its OS, name, CPUs, memory and how long it has been up.', input: {},
    run: () => ({ os: `${os.type()} ${os.release()}`, platform: process.platform, arch: os.arch(), hostname: os.hostname(), cpus: os.cpus().length,
      memoryGB: Math.round(os.totalmem() / 1e9), freeGB: Math.round(os.freemem() / 1e9), uptimeHours: Math.round(os.uptime() / 360) / 10 }) },
  device_notify: { family: 'device', description: 'Show a notification on this machine\'s screen.', input: { title: 'string', text: 'string' },
    run: async (_c, a) => done(await notify(String(a.title || 'DOCA').slice(0, 80), String(a.text || '').slice(0, 300)), 'No notification') },
  device_clipboard_read: { family: 'device', description: 'The text on this machine\'s clipboard.', input: {},
    run: async () => { const r = await clipRead(); if (r.code !== 0) throw new Error(`No clipboard: ${r.stderr.trim()}`); return { text: r.stdout.slice(0, 100000) }; } },
  device_clipboard_write: { family: 'device', description: 'Put text on this machine\'s clipboard.', input: { text: 'string' },
    run: async (_c, a) => done(await clipWrite(String(a.text ?? '')), 'No clipboard') },
});

module.exports.run = run;
