'use strict';

/**
 * The panel in a real headless browser, for a test that has to see what a person sees (keyboard, focus, a list that
 * opens): the hub started by ./helpers on throwaway data, the installed Chrome, Edge or Chromium (modules/headless),
 * signed in as the owner. The caller requires ./helpers first, as every test does. Without a browser, `skip` says so.
 *
 *   const B = require('./panel-browser');
 *   before(() => B.start()); after(() => B.stop());
 *   test('…', { skip: B.skip }, async () => { await B.evaluate('…'); });
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const H = require('./helpers');
const headless = require('../modules/headless');

const exe = headless.findBrowser();
let base, proc, profile, page;
const errors = [];

async function evaluate(expression) {
  const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function until(expression, ms = 15000) {
  for (let t = 0; t < ms; t += 200) { if (await evaluate(expression)) return true; await headless.sleep(200); }
  return false;
}

/**
 * The panel loaded afresh at `hash` (e.g. '#settings/voice'). Chromium drops every load in flight when the machine's
 * network changes (net::ERR_NETWORK_CHANGED: another test making a Docker network), so a load that lost a file is
 * loaded again, and the page errors it caused are dropped with it.
 */
let failedLoads = 0;
async function open(hash = '') {
  for (let attempt = 1; ; attempt++) {
    failedLoads = 0;
    const seen = errors.length;
    await page.send('Page.navigate', { url: `${base}/?t=${Date.now()}${hash}` });
    const loaded = await until("typeof NAV_TABS !== 'undefined' && typeof choiceInput === 'function' && document.readyState === 'complete'", 30000);
    if ((!loaded || failedLoads) && attempt < 3) { errors.splice(seen); continue; }
    if (!loaded) throw new Error('the panel did not load');
    break;
  }
  await headless.sleep(800);
}

/** Chromium and every process it started: its own group on POSIX, the tree on Windows. */
function killBrowser() {
  if (!proc || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') require('node:child_process').spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-proc.pid, 'SIGKILL');
  } catch { try { proc.kill('SIGKILL'); } catch { /* gone */ } }
}

/** `setup(H)` runs after the hub starts and before the page opens (prefs, stubs); `as(H)` signs someone else in. */
async function start({ setup = null, width = 1300, height = 900, as = null } = {}) {
  if (!exe) return;
  base = await H.start();
  if (setup) await setup(H);
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-panel-'));
  proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...headless.ALONE,
    '--disable-gpu', `--window-size=${width},${height}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'],
    { stdio: 'ignore', detached: process.platform !== 'win32' });
  // The whole browser goes when this file does, even when the runner kills it on a timeout and `after` never runs.
  process.once('exit', killBrowser);
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { killBrowser(); process.exit(1); });
  page = await headless.connect(await headless.devtools(profile));
  page.on(m => { if (m.method === 'Network.loadingFailed' && !m.params.canceled && ['Document', 'Script', 'Stylesheet'].includes(m.params.type)) failedLoads++; });
  page.on(m => { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await page.send('Runtime.enable'); await page.send('Network.enable');
  const [name, value] = (as ? (await as(H)).cookie : H.owner.cookie).split('=');
  await page.send('Network.setCookie', { name, value, url: base });
  await open();
}

async function stop() {
  if (!exe) return;
  try { page?.close(); } catch { /* gone */ }
  killBrowser();
  await headless.sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* still locked: the OS cleans temp */ }
  await H.stop();
}

/** A key pressed in the page, as a person would (keydown with its code, then keyup). */
async function key(k) {
  const codes = { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27, Tab: 9 };
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: codes[k] || 0 });
  await headless.sleep(120);
}

/** The page at another size, as a phone (390) or a desk (1300) shows it; `mobile` for touch-sized media queries. */
async function viewport(width, height = 900, mobile = width < 600) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await headless.sleep(300);
}

/** A picture of the page as it is now, to a file — for a person to look at, never checked. */
async function shot(file) {
  await headless.sleep(700);   // a smooth scroll lands first
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}

/** `setup` for a page under test: past the first-run question (Guided or Advanced), which covers every page. */
const pastFirstRun = () => {
  const { loadPrefs, savePrefs } = require('../modules/utils');
  savePrefs({ ...loadPrefs(), setup: { ...(loadPrefs().setup || {}), mode: 'advanced' } });
};

module.exports = { start, stop, open, evaluate, until, key, shot, viewport, pastFirstRun, errors, sleep: headless.sleep, skip: !exe && 'no browser here' };
