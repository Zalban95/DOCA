'use strict';

/**
 * A headless Chrome, Edge or Chromium driven over the DevTools protocol, with no dependency: finding the browser this
 * OS has (or CHROME), its DevTools port, and one page's send/listen. Used by `npm run smoke` (bin/doca-smoke.js) and by
 * the agents' machines page to see the pages agents serve (modules/machines/shots.js).
 */
const fs = require('fs');
const path = require('path');

const CANDIDATES = {
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  win32: [`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`],
};

function findBrowser() {
  if (process.env.CHROME) return process.env.CHROME;
  const { which } = require('./shell');
  for (const c of CANDIDATES[process.platform] || []) {
    if (path.isAbsolute(c)) { if (fs.existsSync(c)) return c; } else { const w = which(c); if (w) return w; }
  }
  return playwrights()[0] || null;
}

/** A Chromium Playwright downloaded (its cache, per OS), newest first: many machines that build software have one. */
function playwrights() {
  const home = require('os').homedir();
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'darwin' ? path.join(home, 'Library', 'Caches', 'ms-playwright')
    : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || home, 'ms-playwright') : path.join(home, '.cache', 'ms-playwright'));
  const exe = { linux: ['chrome-linux64/chrome', 'chrome-linux/chrome'], darwin: ['chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'],
    win32: ['chrome-win64\\chrome.exe', 'chrome-win\\chrome.exe'] }[process.platform] || [];
  let dirs = [];
  try { dirs = fs.readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])); } catch { return []; }
  return dirs.flatMap(d => exe.map(e => path.join(cache, d, e))).filter(p => fs.existsSync(p));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Flags every headless start passes, so the browser stays DOCA's and not the person's. On Windows, Edge started with
 * a fresh profile from the person's session signs itself in to their Microsoft account and syncs their data into it —
 * on a real Windows 11 host (H1.9, 2026-10-08) eighteen of the person's extensions arrived in a throwaway profile
 * within twenty seconds. msImplicitSignin off keeps the account out; sync off keeps their data out whatever signs in.
 * Chrome and Chromium take --disable-sync too and ignore a feature they do not know.
 *
 * And no system keyring: on Linux, Chromium encrypts its cookie store through the person's keyring (GNOME Keyring,
 * KWallet) over D-Bus, and when that keyring is locked or does not answer — a server, a session nobody signed in to
 * with a password, a keyring daemon stuck — every cookie write waits forever. The sign-in cookie DOCA's own page needs
 * never lands, so the smoke, Machines → Live's pictures and the agent's page checks hang (found 2026-10-08: every
 * Network.setCookie timed out on the hub). A throwaway profile has nothing to protect, so it keeps its cookies in the
 * profile itself (`basic`); `--use-mock-keychain` is the same on macOS, where the login keychain can prompt.
 */
const ALONE = ['--disable-sync', '--disable-features=msImplicitSignin', '--password-store=basic', '--use-mock-keychain'];

async function devtools(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 400; i++) {
    // Windows locks the file while the browser writes it (EBUSY): a read that fails is a read too early, tried again.
    let port = '';
    try { port = fs.readFileSync(file, 'utf8').split('\n')[0]; } catch { /* not there yet, or still being written */ }
    if (port) return Number(port);
    await sleep(150);
  }
  throw new Error('The browser did not open its DevTools port.');
}

/** One page over CDP: send, and every event to a listener. */
async function connect(port) {
  let targets = [];
  for (let i = 0; i < 40 && !targets.some(t => t.type === 'page'); i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* starting */ } await sleep(150); }
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('No page target in the browser.');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('Cannot reach the page over CDP.')); });
  let seq = 0;
  const pending = new Map(), listeners = [];
  ws.onmessage = ev => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    else if (m.method) for (const l of listeners) l(m);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  return { send, on: l => listeners.push(l), close: () => ws.close() };
}

module.exports = { findBrowser, devtools, connect, sleep, CANDIDATES, ALONE };
