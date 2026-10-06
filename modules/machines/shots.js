'use strict';

/**
 * Pictures of the pages agents serve (index.js `served`), taken by a headless browser on the hub (modules/headless.js)
 * while a Machines → Live page asks for them: one tab per page, a fresh picture every SHOT_MS, the browser closed IDLE_MS
 * after the last ask. Only addresses on this machine reach it (index.js decides), and nothing is kept on disk. Without
 * a browser on this machine there are no pictures, and `browser()` says so (System tools offers one).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SHOT_MS = 4000, IDLE_MS = 60000, MAX_PAGES = 8;
let _proc = null, _port = null, _profile = null, _starting = null, _idle = null, _gen = 0;   // _gen: a close() since a tab began opening ends it
const _tabs = new Map();    // key → { url, cdp, timer }
const _shots = new Map();   // key → PNG buffer
const _opening = new Set();  // keys whose tab is being opened: asked again meanwhile, not opened twice

let _lastError = null;   // why the last picture could not be taken, for the page and the tests
const browser = () => { const p = require('../headless').findBrowser(); return p ? { found: true, error: _lastError } : { found: false, why: 'No Chrome, Edge or Chromium on this machine: install one (Settings → System → System tools) to see the pages agents serve.' }; };

async function launch() {
  if (_port) return _port;
  if (_starting) return _starting;
  _starting = (async () => {
    const h = require('../headless');
    const exe = h.findBrowser();
    if (!exe) throw new Error('no browser');
    _profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-shots-'));
    _proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${_profile}`, '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--window-size=1280,800', '--mute-audio', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
    _proc.on('exit', () => close());
    _port = await h.devtools(_profile);
    return _port;
  })().finally(() => { _starting = null; });
  return _starting;
}

async function openTab(key, url) {
  const gen = _gen;
  const port = await launch();
  if (gen !== _gen) return;
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  if (gen !== _gen) return;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error(`cannot reach the tab over CDP (${t.webSocketDebuggerUrl || JSON.stringify(t).slice(0, 120)})`)); });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(String(ev.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const tab = { url, id: t.id, send, ws, timer: null };
  const take = async () => {
    const r = await send('Page.captureScreenshot', { format: 'png' }).catch(e => ({ error: { message: e.message } }));
    if (r?.result?.data) _shots.set(key, Buffer.from(r.result.data, 'base64'));
    else _lastError = `screenshot: ${r?.error?.message || 'no picture'}`;
  };
  tab.timer = setInterval(take, SHOT_MS);
  tab.timer.unref?.();
  setTimeout(take, 1500).unref?.();
  _tabs.set(key, tab);
}

function closeTab(key) {
  const t = _tabs.get(key);
  if (!t) return;
  clearInterval(t.timer);
  try { t.ws.close(); } catch { /* closed */ }
  if (_port) fetch(`http://127.0.0.1:${_port}/json/close/${t.id}`).catch(() => {});
  _tabs.delete(key); _shots.delete(key);
}

/** The pages a Live page is showing now: tabs opened for new ones, closed for gone ones; the browser kept while asked. */
function want(pages) {
  clearTimeout(_idle);
  _idle = setTimeout(close, IDLE_MS);
  _idle.unref?.();
  if (!browser().found) return;
  const keys = new Set(pages.slice(0, MAX_PAGES).map(p => p.key));
  for (const k of [..._tabs.keys()]) if (!keys.has(k)) closeTab(k);
  for (const p of pages.slice(0, MAX_PAGES)) if (!_tabs.has(p.key) && !_opening.has(p.key)) {
    _opening.add(p.key);
    openTab(p.key, p.url).then(() => { _lastError = null; }, e => { _lastError = e.message; }).finally(() => _opening.delete(p.key));
  }
}

function close() {
  _gen++;
  for (const k of [..._tabs.keys()]) closeTab(k);
  clearTimeout(_idle);
  try { _proc?.kill(); } catch { /* gone */ }
  const profile = _profile;
  _proc = null; _port = null; _profile = null;
  if (profile) setTimeout(() => fs.rm(profile, { recursive: true, force: true }, () => {}), 1500);
}

const get = key => _shots.get(key) || null;
const has = key => _shots.has(key);

module.exports = { want, get, has, close, browser };
