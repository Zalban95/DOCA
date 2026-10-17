// A headless Chrome (or Chromium, or Edge) driven over the DevTools protocol through a pipe — no dependency. Used by
// test/browser.test.js (it lives here, not in test/, so the test runner does not take it for a test). Set CHROME to
// the browser's path when it is somewhere unusual.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const home = os.homedir();
  const fixed = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    win32: [`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`],
  }[process.platform] || [];
  for (const f of fixed) if (fs.existsSync(f)) return f;
  if (process.platform === 'linux') for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    try { return execFileSync('which', [n], { encoding: 'utf8' }).trim(); } catch { /* not this one */ }
  }
  // A Chromium that Playwright downloaded.
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'darwin' ? path.join(home, 'Library/Caches/ms-playwright')
    : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || home, 'ms-playwright') : path.join(home, '.cache/ms-playwright'));
  let dirs = [];
  try { dirs = fs.readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort().reverse(); } catch { return null; }
  for (const d of dirs) for (const e of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe', 'chrome-win64/chrome.exe']) {
    if (fs.existsSync(path.join(cache, d, e))) return path.join(cache, d, e);
  }
  return null;
}

export function launch(exe) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-chrome-'));
  const args = ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--mute-audio', '--disable-sync', '--password-store=basic', '--use-mock-keychain', '--autoplay-policy=no-user-gesture-required'];
  // Only the game, served from this machine, is opened. Linux distributions that restrict user namespaces (Ubuntu
  // 23.10+) leave Chrome no sandbox to start, so it runs without one there — as headless page checks usually do.
  if (process.platform === 'linux') args.push('--no-sandbox');
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const toChrome = proc.stdio[3], fromChrome = proc.stdio[4];
  let id = 0, buf = '';
  const waiting = new Map(), listeners = [];
  fromChrome.on('data', d => {
    buf += d.toString('utf8');
    for (let i; (i = buf.indexOf('\0')) >= 0;) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      const w = msg.id && waiting.get(msg.id);
      if (w) { waiting.delete(msg.id); if (msg.error) w.reject(new Error(msg.error.message)); else w.resolve(msg.result); } else for (const l of listeners) l(msg);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const m = { id: ++id, method, params, ...(sessionId ? { sessionId } : {}) };
    waiting.set(m.id, { resolve, reject });
    toChrome.write(`${JSON.stringify(m)}\0`);
  });
  const close = async () => { proc.kill(); await sleep(300); fs.rmSync(dir, { recursive: true, force: true }); };
  return { send, on: f => listeners.push(f), close };
}

/** A new tab: send, evaluate(expression), until(expression), and every error its console or scripts raised. */
export async function newPage(browser) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => browser.send(m, p, sessionId);
  const errors = [];
  browser.on(msg => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(`${msg.params.entry.text} ${msg.params.entry.url || ''}`.trim());
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (expression, ms = 8000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expression).catch(() => null);
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for: ${expression}`);
      await sleep(100);
    }
  };
  const shot = async file => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(data, 'base64')); };
  return { send, evaluate, until, errors, shot, sleep };
}
