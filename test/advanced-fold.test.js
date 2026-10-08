'use strict';

/**
 * Organized: the common few, the rest under Advanced (asked 2026-10-08; js/lib/ui-parts.js advancedFold). In the
 * panel as a browser draws it: the fold is closed until opened, its state is remembered per browser per id, it counts
 * what it holds and is marked when something inside differs from its default; and every page that folds fields still
 * draws every one of them (test/advanced-fold-pages.js lists them). Skipped where no Chrome, Edge or Chromium is found.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const H = require('./helpers');   // first: it points the settings at a temporary folder (see its top)
const headless = require('../modules/headless');
const PAGES = require('./advanced-fold-pages');

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
let failedLoads = 0;
const open = async () => {
  for (let attempt = 1; ; attempt++) {
    failedLoads = 0;
    const seen = errors.length;
    await page.send('Page.navigate', { url: `${base}/` });
    const loaded = await until("typeof NAV_TABS !== 'undefined' && typeof advancedFold === 'function' && document.readyState === 'complete'", 30000);
    if ((!loaded || failedLoads) && attempt < 3) { errors.splice(seen); continue; }
    assert.ok(loaded, 'the panel loaded');
    break;
  }
  await headless.sleep(800);
};

before(async () => {
  if (skip) return;
  base = await H.start();
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-fold-'));
  proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...headless.ALONE,
    '--disable-gpu', '--window-size=1300,900', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'],
    { stdio: 'ignore', detached: process.platform !== 'win32' });
  // The whole browser goes when this file does, even when the runner kills it on a timeout and `after` never runs:
  // a left Chromium per failed run once piled up to 60 processes and stalled every other browser test (2026-10-08).
  process.once('exit', killBrowser);
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { killBrowser(); process.exit(1); });
  page = await headless.connect(await headless.devtools(profile));
  page.on(m => { if (m.method === 'Network.loadingFailed' && !m.params.canceled && ['Document', 'Script', 'Stylesheet'].includes(m.params.type)) failedLoads++; });
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

test('a fold is closed, counts what it holds, and is marked when a field inside is not its default', { skip }, async () => {
  const r = await evaluate(`(() => {
    const host = document.createElement('div'); host.id = 'fold-probe'; document.body.append(host);
    host.innerHTML = advancedFold('<input id="fp-a" data-default="5" value="5"><select id="fp-b" data-default="x"><option>x</option><option>y</option></select>'
      + '<input type="checkbox" id="fp-c" data-default="false"><textarea id="fp-d" data-default="*">*</textarea><input id="fp-e">', { id: 'probe' });
    const det = host.querySelector('details.adv-fold');
    advancedFoldMark(det);
    const sum = det.querySelector('summary');
    return { open: det.open, label: sum.querySelector('.adv-fold-label').textContent, count: sum.querySelector('.adv-fold-count').textContent,
      marked: !sum.querySelector('.adv-fold-changed').hidden };
  })()`);
  assert.deepEqual(r, { open: false, label: 'Advanced', count: '5', marked: false }, 'closed, five fields, nothing changed');

  const changed = await evaluate(`(() => {
    const a = document.getElementById('fp-a'); a.value = '7'; a.dispatchEvent(new Event('input', { bubbles: true }));
    const m = document.querySelector('#fold-probe .adv-fold-changed');
    const first = { marked: !m.hidden, title: m.title };
    const c = document.getElementById('fp-c'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
    const second = m.textContent;
    a.value = '5'; c.checked = false; document.getElementById('fp-d').value = '*\\n'; advancedFoldRefresh(document.getElementById('fold-probe'));
    return { first, second, back: m.hidden, open: document.querySelector('#fold-probe details').open };
  })()`);
  assert.equal(changed.first.marked, true, 'a changed value marks the closed fold');
  assert.match(changed.first.title, /Not the default: fp-a/);
  assert.equal(changed.second, '2 changed');
  assert.equal(changed.back, true, 'back at the defaults, the mark goes (a trailing blank line is not a change)');
  assert.equal(changed.open, true, 'an untrusted input (form_fill\'s draft) opened the fold so it is seen');
});

test('its open state is remembered per browser per id, and a fold of existing elements keeps them', { skip }, async () => {
  await evaluate(`(() => { const d = document.querySelector('#fold-probe details'); d.open = false; })()`);
  await headless.sleep(100);
  await evaluate(`(() => { const d = document.querySelector('#fold-probe details'); d.open = true; })()`);
  await headless.sleep(100);
  assert.equal(await evaluate("localStorage.getItem('doca.fold.probe')"), '1');
  await open();
  const r = await evaluate(`(() => {
    const host = document.createElement('div'); document.body.append(host);
    host.innerHTML = advancedFold('<input>', { id: 'probe', label: 'More' }) + advancedFold('<input>', { id: 'other' });
    const [a, b] = host.querySelectorAll('details');
    const form = document.createElement('div'); form.innerHTML = '<input id="w1" value="on"><label>keep</label><input id="w2" data-default="" value="set">';
    document.body.append(form);
    const det = advancedFold([form.querySelector('#w1'), form.querySelector('label'), form.querySelector('#w2')], { id: 'wrapped', label: 'Wrapped' });
    return { probe: a.open, other: b.open, label: a.querySelector('.adv-fold-label').textContent, inForm: det.parentNode === form,
      held: det.querySelectorAll('.adv-fold-body > *').length, marked: !det.querySelector('.adv-fold-changed').hidden, count: det.querySelector('.adv-fold-count').textContent };
  })()`);
  assert.deepEqual(r, { probe: true, other: false, label: 'More', inForm: true, held: 3, marked: true, count: '2' });
});

for (const p of PAGES) {
  test(`every field still drawn: ${p.name}`, { skip }, async () => {
    await evaluate(`(async () => { ${p.go} })()`);
    assert.ok(await until(`!!document.querySelector(${JSON.stringify(p.ready)})`), `${p.name} drew (${p.ready})`);
    await headless.sleep(400);
    const r = await evaluate(`(() => {
      const q = sel => document.querySelector(sel);
      const missing = ${JSON.stringify(p.fields)}.filter(sel => !q(sel));
      const notFolded = ${JSON.stringify(p.folded || [])}.filter(sel => !q(sel)?.closest('details.adv-fold'));
      const shown = ${JSON.stringify(p.shown || [])}.filter(sel => q(sel)?.closest('details.adv-fold'));
      const folds = [...document.querySelectorAll(${JSON.stringify(p.scope)} + ' details.adv-fold')];
      return { missing, notFolded, shown, folds: folds.length, empty: folds.filter(d => !d.querySelector('.adv-fold-body input, .adv-fold-body select, .adv-fold-body textarea')).length };
    })()`);
    assert.deepEqual(r.missing, [], 'no field went missing');
    assert.deepEqual(r.notFolded, [], 'the advanced ones are under Advanced');
    assert.deepEqual(r.shown, [], 'the common few are not');
    assert.ok(r.folds >= 1, 'the page has its fold');
    assert.equal(r.empty, 0, 'no fold is empty');
    if (p.after) await evaluate(`(() => { ${p.after} })()`);
  });
}

test('no page error while drawing them', { skip }, () => {
  assert.deepEqual(errors, []);
});
