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
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function devtools(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 400; i++) { if (fs.existsSync(file)) { const port = fs.readFileSync(file, 'utf8').split('\n')[0]; if (port) return Number(port); } await sleep(150); }
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

module.exports = { findBrowser, devtools, connect, sleep, CANDIDATES };
