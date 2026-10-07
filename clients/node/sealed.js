'use strict';

/**
 * doca-client's half of a sealed secret (DOCA's PROTOCOL.md §22.3; TODO P1.3, CONSTITUTION S4). The hub hands this
 * machine a password, a PIN or a key for one use: sealed with the key it gave this machine alone (`sealKey`, taken
 * from GET /api/v1/mcp/self/seal at `run`), to the hidden tool `secret_fill`, which tools/list never offers. Opened
 * here, checked (for this machine, recent, never seen before), used once as the hub said, and forgotten; the answer
 * says what was done, never the value.
 *
 *   type       typed into what has focus — xdotool (X11), wtype or ydotool (Wayland), System Events (macOS),
 *              SendKeys (Windows); the value goes on the program's stdin or in its environment, never in its argv
 *   clipboard  on the clipboard for `uses` pastes or `ttlSec`, whichever is first: X11's xclip serves exactly N pastes
 *              (-loops) and Wayland's wl-copy one (--paste-once); macOS and Windows cannot count, so the clipboard is
 *              cleared after the time (Windows keeps it out of clipboard history and the cloud clipboard)
 *
 * While a secret sits on the clipboard, this machine refuses the hub's clipboard reads and command lines — the two
 * ways an agent could read it back. Needs the `device` family lent (the one that already writes the clipboard).
 */
const crypto = require('crypto');
const { spawn } = require('child_process');
const { run } = require('./families');

const win = process.platform === 'win32', mac = process.platform === 'darwin';
const seen = new Map();   // nonce → until: a sealed secret is used once
let armed = null;         // { until, stop } while a secret sits on the clipboard

/** Open a sealed payload with this machine's key; throws a sentence (never the value) when it is not for here. */
function open(cfg, sealed) {
  if (!cfg.sealKey) throw new Error('This machine has not taken its seal key from the hub yet: run doca-client again (after doca-client update).');
  let p;
  try {
    const raw = Buffer.from(String(sealed?.data || ''), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(cfg.sealKey, 'base64'), Buffer.from(String(sealed?.iv || ''), 'base64'));
    d.setAAD(Buffer.from(`doca-seal:${cfg.deviceId}`));
    d.setAuthTag(raw.subarray(raw.length - 16));
    p = JSON.parse(Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8'));
  } catch { throw new Error('This was not sealed for this machine: refused.'); }
  if (p.device !== cfg.deviceId) throw new Error('This was sealed for another device: refused.');
  if (!(Math.abs(Date.now() - Number(p.iat)) < 5 * 60e3)) throw new Error('This sealed secret is too old (or this machine\'s clock is minutes off): refused.');
  for (const [n, until] of seen) if (until < Date.now()) seen.delete(n);
  if (seen.has(p.nonce)) throw new Error('This sealed secret was already used: refused.');
  seen.set(p.nonce, Date.now() + 10 * 60e3);
  return p;
}

const has = async cmd => (await run(cmd, ['--version'], { timeoutMs: 3000 })).code !== -2;
const escapeSendKeys = "($env:DOCA_SEAL -replace '[+^%~(){}\\[\\]]','{$0}')";

/** The OS's ways in. Replaced by the tests (`adapter`), which cannot type into a desktop. */
const adapter = {
  async type(value) {
    let r;
    if (win) r = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${escapeSendKeys})`], { env: { DOCA_SEAL: value } });
    else if (mac) r = await run('osascript', ['-e', 'tell application "System Events" to keystroke (system attribute "DOCA_SEAL")'], { env: { DOCA_SEAL: value } });
    else {
      const tries = process.env.WAYLAND_DISPLAY ? [['wtype', ['-']], ['ydotool', ['type', '--file', '-']]] : [['xdotool', ['type', '--clearmodifiers', '--file', '-']]];
      r = { code: -2, stderr: `none of ${tries.map(t => t[0]).join(', ')} is installed` };
      for (const [cmd, args] of tries) { const x = await run(cmd, args, { input: value }); if (x.code !== -2) { r = x; break; } }
    }
    if (r.code !== 0) throw new Error(`Could not type it: ${String(r.stderr || '').split(value).join('[secret]').trim() || `exit ${r.code}`}.`);
  },
  /** Put it on the clipboard; resolves { counted, stop } — stop() takes it off (or lets it go). */
  async clip(value, uses, onGone) {
    if (!win && !mac) {
      const wayland = !!process.env.WAYLAND_DISPLAY && await has('wl-copy');
      const [cmd, args] = wayland ? ['wl-copy', ['--foreground', ...(uses === 1 ? ['--paste-once'] : [])]] : ['xclip', ['-selection', 'clipboard', '-quiet', '-loops', String(uses), '-i']];
      const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
      const started = await new Promise(resolve => { child.on('error', () => resolve(false)); child.on('spawn', () => resolve(true)); });
      if (!started) throw new Error(`No clipboard: ${wayland ? 'wl-copy' : 'xclip'} is not installed.`);
      child.stdin.end(value);
      child.on('close', onGone);   // the pastes were served, or it was stopped: the clipboard no longer holds it
      return { counted: !wayland || uses === 1, stop: () => { try { child.kill(); } catch { /* gone */ } } };
    }
    const set = win
      ? await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.DataObject; $d.SetText($env:DOCA_SEAL); '
        + "foreach($f in 'CanIncludeInClipboardHistory','CanUploadToCloudClipboard'){ $d.SetData($f,(New-Object System.IO.MemoryStream(,[byte[]](0,0,0,0)))) }; "
        + "$d.SetData('ExcludeClipboardContentFromMonitorProcessing',(New-Object System.IO.MemoryStream(,[byte[]](0,0,0,0)))); [System.Windows.Forms.Clipboard]::SetDataObject($d,$true)"], { env: { DOCA_SEAL: value } })
      : await run('pbcopy', [], { input: value });
    if (set.code !== 0) throw new Error('No clipboard on this machine.');
    const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex'), mine = sha(value);
    return { counted: false, stop: async () => {   // cleared only if it still holds the secret: something copied since is the person's
      const now = win ? await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw']) : await run('pbpaste', []);
      const got = String(now.stdout || '');
      if (sha(win ? got.replace(/\r?\n$/, '') : got) === mine)
        await (win ? run('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()']) : run('pbcopy', [], { input: '' }));
      onGone();
    } };
  },
};

function disarm() { const a = armed; armed = null; if (a) { clearTimeout(a.timer); a.stop(); } }

/** The hidden tool: { done, uses, counted, seconds } — never the value. */
async function fill(cfg, args) {
  if (cfg.grants?.device !== true || (cfg.revoked || []).includes('device')) throw new Error('This machine does not lend its device family (the clipboard and typing), so it takes no secrets.');
  const p = open(cfg, args?.sealed);
  const value = String(p.value ?? '');
  const seconds = Math.min(300, Math.max(5, Number(p.ttlSec) || 30));
  if (p.how === 'field') throw new Error('This machine has no web page to fill: use the clipboard or typing.');
  if (p.how === 'type') { await module.exports.adapter.type(value); return { done: 'typed', uses: 1, seconds: 0 }; }
  const uses = Math.min(10, Math.max(1, Number(p.uses) || 1));
  disarm();   // one secret on the clipboard at a time
  const mark = {};
  const c = await module.exports.adapter.clip(value, uses, () => { if (armed === mark) { clearTimeout(mark.timer); armed = null; } });
  Object.assign(mark, { until: Date.now() + seconds * 1000, stop: c.stop, timer: setTimeout(() => { if (armed === mark) disarm(); }, seconds * 1000) });
  mark.timer.unref?.();
  armed = mark;
  return { done: 'clipboard', uses, counted: c.counted, seconds };
}

/** While a secret sits on the clipboard: what this machine refuses the hub (a sentence), or null. */
function blocks(name) {
  if (!armed || !['device_clipboard_read', 'shell_run', 'shell'].includes(name)) return null;
  return `A secret is on this machine's clipboard for ${Math.ceil((armed.until - Date.now()) / 1000)} s more; ${name} waits until it is gone.`;
}

module.exports = { fill, open, blocks, disarm, adapter, armed: () => !!armed };
