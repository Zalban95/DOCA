#!/usr/bin/env node
'use strict';

/**
 * The panel in a real browser, on whatever OS this runs on (TODO H1.1, H1.9; hive.md §7): boot the app with
 * throwaway data, sign an owner in, open the page in the installed Chrome (or Edge, or Chromium) headless,
 * visit every tab, and fail on any page error. CI runs it on Linux, Windows and macOS, so "the panel loads on
 * a Mac" is checked on every push rather than assumed. No dependency: the browser is driven over the DevTools
 * protocol with Node's own WebSocket.
 *
 *   npm run smoke            CHROME=/path/to/chrome npm run smoke
 *
 * The panel runs in a child process (`--serve`) that is killed at the end: node-pty's reader thread keeps a
 * process alive after its shell is gone and aborts it on exit(), so the process that reports the result never
 * loads it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CANDIDATES = {
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  win32: [`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`],
};

function findBrowser() {
  if (process.env.CHROME) return process.env.CHROME;
  const { which } = require('../modules/shell');
  for (const c of CANDIDATES[process.platform] || []) {
    if (path.isAbsolute(c)) { if (fs.existsSync(c)) return c; } else { const w = which(c); if (w) return w; }
  }
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function devtools(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) { if (fs.existsSync(file)) { const port = fs.readFileSync(file, 'utf8').split('\n')[0]; if (port) return Number(port); } await sleep(150); }
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

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) { console.log('smoke: no Chrome, Edge or Chromium found — set CHROME to run it. Skipped.'); return 0; }
  const child = spawn(process.execPath, [__filename, '--serve'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const { base, cookie, data } = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', d => { buf += d; const line = buf.split('\n').find(l => l.startsWith('{')); if (line) resolve(JSON.parse(line)); });
    child.on('exit', code => reject(new Error(`the panel did not start (exit ${code})`)));
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-smoke-'));
  const proc = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--window-size=1300,900', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
  const errors = [];
  const absent = new Set();
  try {
    const cdp = await connect(await devtools(profile));
    cdp.on(m => {
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method !== 'Log.entryAdded' || m.params.entry.level !== 'error' || /favicon/.test(m.params.entry.url || '')) return;
      // 502/503/504: an optional backend this machine lacks (Ollama, Docker…), a state the panel draws — noted, not failed.
      if (/status of 50[234]\b/.test(m.params.entry.text)) absent.add(new URL(m.params.entry.url || base).pathname);
      else errors.push(`console: ${m.params.entry.text}${m.params.entry.url ? ` — ${m.params.entry.url}` : ''}`);
    });
    await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Network.enable');
    const [name, value] = cookie.split('=');
    await cdp.send('Network.setCookie', { name, value, url: base });
    await cdp.send('Page.navigate', { url: `${base}/` });
    // Until the panel's scripts have run — seconds on a cold Windows runner — not a fixed wait.
    let tabs = null;
    for (let i = 0; i < 60 && !tabs; i++) {
      await sleep(500);
      tabs = (await cdp.send('Runtime.evaluate', { expression: "typeof NAV_TABS !== 'undefined' && document.readyState === 'complete' ? JSON.stringify(NAV_TABS) : ''", returnByValue: true })).result.value || null;
    }
    await sleep(1000);
    if (!tabs) throw new Error('The panel did not load (no NAV_TABS).');
    for (const t of JSON.parse(tabs)) { await cdp.send('Runtime.evaluate', { expression: `nav(${JSON.stringify(t)})` }); await sleep(500); }
    for (const sub of ['general', 'channels', 'packs', 'harness', 'system', 'experiments']) { await cdp.send('Runtime.evaluate', { expression: `nav('settings'); settingsSubNav(${JSON.stringify(sub)})` }); await sleep(500); }
    const face = await cdp.send('Page.navigate', { url: `${base}/face` }); void face;
    await sleep(1500);
    console.log(`smoke: ${process.platform}, ${path.basename(browserPath)}, ${JSON.parse(tabs).length} tabs visited, /face opened — ${errors.length} page error${errors.length === 1 ? '' : 's'}`);
    for (const e of errors) console.log(`  ✗ ${String(e).split('\n')[0]}`);
    if (absent.size) console.log(`  · not on this machine (answered 50x, drawn as such): ${[...absent].join(', ')}`);
    cdp.close();
    return errors.length ? 1 : 0;
  } finally {
    proc.kill();
    child.kill('SIGKILL');
    await sleep(500);
    // The killed panel's throwaway data. Best effort: on Windows its database can still be locked for a moment,
    // and a folder left in the temp directory is not a reason to fail a smoke that passed.
    try { if (data) fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) { console.log(`  · left ${data} behind (${e.code})`); }
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* the browser's profile, still locked: the OS cleans temp */ }
  }
}

/** The child: the panel on throwaway data with the WebSocket routes, an owner signed in; prints {base, cookie}. */
async function serve() {
  const H = require('../test/helpers');
  const http = require('http'); const make = http.createServer; let server;
  http.createServer = (...a) => (server = make(...a));
  const base = await H.start();
  http.createServer = make;
  require('../modules/terminal').setup(server);
  process.stdout.write(`${JSON.stringify({ base, cookie: H.owner.cookie, data: path.dirname(process.env.DOCA_DATA_DIR) })}\n`);
}

if (process.argv[2] === '--serve') serve().catch(e => { console.error(`smoke server: ${e.message}`); process.exit(1); });
else main().then(code => process.exit(code)).catch(e => { console.error(`smoke: ${e.message}`); process.exit(1); });
