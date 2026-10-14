'use strict';

/**
 * The cast remote on the screen that shows the page (public/js/cast-remote.js; modules/cast/remote.js), in a real
 * browser: a key pressed through the hub moves the outline and OK presses it, Back answers an open question with its
 * own "Not now", and a question about a switch is noted at the foot of a cast screen instead of drawn in its way.
 * Skipped where no Chrome, Edge or Chromium is found.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const H = require('./helpers');   // first: it points the settings at a temporary folder (see its top)
const headless = require('../modules/headless');

const exe = headless.findBrowser();
const skip = !exe && 'no browser here';
let base, proc, profile, page;
const errors = [];

const evaluate = async expression => {
  const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const until = async (expression, ms = 15000) => {
  for (let t = 0; t < ms; t += 200) { if (await evaluate(expression)) return true; await headless.sleep(200); }
  return false;
};
// Chromium drops every load in flight when this machine's network changes (net::ERR_NETWORK_CHANGED — another test
// making a Docker network does it), which left the panel without half its scripts now and then under a full run: a
// load that lost a file is loaded again, and the page errors it caused are not this page's.
let failedLoads = 0, netChanged = 0;
const open = async () => {
  for (let attempt = 1; ; attempt++) {
    failedLoads = 0;
    const seen = errors.length;
    await page.send('Page.navigate', { url: `${base}/?view=live` });
    const loaded = await until("typeof NAV_TABS !== 'undefined' && typeof castRemotePress === 'function' && document.readyState === 'complete'", 30000);
    if ((!loaded || failedLoads) && attempt < 3) { errors.splice(seen); continue; }
    assert.ok(loaded, 'the panel loaded');
    break;
  }
  await headless.sleep(800);
};

before(async () => {
  if (skip) return;
  base = await H.start();
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-remote-'));
  proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...headless.ALONE,
    '--disable-gpu', '--window-size=1300,900', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'],
    { stdio: 'ignore', detached: process.platform !== 'win32' });
  // The whole browser goes when this file does, even when the runner kills it on a timeout and `after` never runs:
  // a left Chromium per failed run once piled up to 60 processes and stalled every other browser test (2026-10-08).
  process.once('exit', killBrowser);
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { killBrowser(); process.exit(1); });
  page = await headless.connect(await headless.devtools(profile));
  page.on(m => { if (m.method === 'Network.loadingFailed' && !m.params.canceled && ['Document', 'Script', 'Stylesheet'].includes(m.params.type)) failedLoads++; });
  page.on(m => { if (m.method === 'Network.loadingFailed' && /ERR_NETWORK_CHANGED/.test(m.params.errorText || '')) netChanged++; });   // any request, a page's data too
  page.on(m => { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await page.send('Runtime.enable'); await page.send('Network.enable');
  const [name, value] = H.owner.cookie.split('=');
  await page.send('Network.setCookie', { name, value, url: base });
  await open();
});

/** Chromium and every process it started: its own group on POSIX, the tree on Windows. */
function killBrowser() {
  if (!proc || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') require('node:child_process').spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-proc.pid, 'SIGKILL');
  } catch { try { proc.kill('SIGKILL'); } catch { /* gone */ } }
}

after(async () => {
  if (skip) return;
  try { page?.close(); } catch { /* gone */ }
  killBrowser();
  await headless.sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* still locked: the OS cleans temp */ }
  await H.stop();
});

test('a cast screen: keys through the hub move the outline, OK presses, Back says Not now, a switch question is a note', { skip }, async () => {
  await evaluate("document.body.classList.add('cast-view'); document.activeElement?.blur(); true");
  // This browser's own screen record, which the remote is pressed for through the hub, as the phone's pad does.
  const here = await evaluate("apiFetch('/api/cast/targets').then(d => d.targets.find(t => t.here)?.id)");
  assert.ok(here, 'the page has a screen record');
  const press = key => evaluate(`apiFetch('/api/cast/remote', { method: 'POST', body: { screen: ${JSON.stringify(here)}, key: '${key}' } }).then(() => true)`);
  await press('down');
  assert.ok(await until("document.activeElement && document.activeElement !== document.body"), 'the first press puts the outline on something');
  const first = await evaluate("document.activeElement.outerHTML.slice(0, 80)");
  await press('right'); await press('down');
  await headless.sleep(600);
  const moved = await evaluate("document.activeElement.outerHTML.slice(0, 80)");
  assert.notEqual(moved, first, 'it moved');

  // OK presses what is outlined; Back answers a question with its own Not now.
  const ok = await evaluate(`(() => { const b = document.createElement('button'); b.id = 'cr-probe'; b.textContent = 'probe'; b.onclick = () => { b.dataset.pressed = '1'; };
    document.querySelector('main.content').prepend(b); b.focus(); castRemotePress('ok'); return b.dataset.pressed === '1'; })()`);
  assert.equal(ok, true);
  const back = await evaluate(`(() => { const d = document.createElement('div'); d.className = 'app-confirm-backdrop open'; d.innerHTML = '<button>Do it</button><button>Not now</button>';
    let said = null; d.querySelectorAll('button')[1].onclick = () => { said = 'not now'; d.remove(); };
    document.body.append(d); castRemotePress('back'); return said; })()`);
  assert.equal(back, 'not now');

  const asked = await evaluate(`switchAskWait({ code: 'switch_off', message: 'off', needs: { what: 'Managing this machine from the local network', route: null } })
    .then(r => ({ r, dialog: !!document.querySelector('.switch-ask'), note: document.getElementById('cast-view-note')?.textContent || '' }))`);
  assert.equal(asked.r, false);
  assert.equal(asked.dialog, false, 'no dialog on a screen nobody answers');
  assert.match(asked.note, /cannot show on this screen/);
  assert.deepEqual(errors, []);
});
