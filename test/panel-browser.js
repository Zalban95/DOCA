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

/** The panel loaded afresh at `hash` (e.g. '#settings/voice'). */
async function open(hash = '') {
  await page.send('Page.navigate', { url: `${base}/?t=${Date.now()}${hash}` });
  if (!await until("typeof NAV_TABS !== 'undefined' && typeof choiceInput === 'function' && document.readyState === 'complete'", 30000)) throw new Error('the panel did not load');
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

/** `setup(H)` runs after the hub starts and before the page opens (prefs, stubs). */
async function start({ setup = null, width = 1300, height = 900 } = {}) {
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
  page.on(m => { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await page.send('Runtime.enable'); await page.send('Network.enable');
  const [name, value] = H.owner.cookie.split('=');
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

module.exports = { start, stop, open, evaluate, until, key, errors, sleep: headless.sleep, skip: !exe && 'no browser here' };
