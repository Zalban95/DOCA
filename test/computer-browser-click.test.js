'use strict';

/**
 * A computer's browser_click either lands on the element it was given or says where it went (self-test round two,
 * B4). Snapshots used to leave their numbers on the page, so after a page change a hidden control kept its old number,
 * came first, and a click by that number went to it — at 0,0 — and was reported done. Runs the computer's own tools
 * against the installed Chromium, headless; skipped where there is none.
 */
require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { findBrowser, devtools } = require('../modules/headless');

const browser = findBrowser();
let proc, profile, run;
const PAGE = `<!doctype html><title>start</title><body style="margin:40px">
<button id="a" onclick="document.title='a'">Alpha</button>
<button id="b" onclick="document.title='b'">Beta</button>
<button id="c" onmousedown="this.style.marginLeft='600px'" onclick="document.title='c'">Gamma</button></body>`;

before(async () => {
  if (!browser) return;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-click-'));
  proc = spawn(browser, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--window-size=1000,700', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
  process.env.CDP_PORT = String(await devtools(profile));
  const { TOOLS } = require('../clients/computer/tools');
  run = async (name, args = {}) => {
    try { const r = await TOOLS.find(t => t.name === name).run(args); return { ...r, said: r.content.map(c => c.text || '').join('') }; }
    catch (e) { return { isError: true, said: e.message }; }
  };
});
after(() => { proc?.kill(); try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* the OS cleans temp */ } });

const refOf = (snap, label) => Number(snap.split('\n').find(l => l.includes(`"${label}"`))?.match(/^\[(\d+)\]/)?.[1]);

test('after the page changes, a number means what the new snapshot says it means', { skip: !browser && 'no Chromium here' }, async () => {
  await run('browser_open', { url: `data:text/html,${encodeURIComponent(PAGE)}` });
  const first = (await run('browser_snapshot')).said;
  assert.equal(refOf(first, 'Alpha'), 1);
  const { Cdp } = require('../clients/computer/cdp');
  const cdp = await new Cdp(Number(process.env.CDP_PORT)).connect();
  await cdp.evaluate(`document.getElementById('a').style.display = 'none'`);
  const second = (await run('browser_snapshot')).said;
  const beta = refOf(second, 'Beta');
  assert.equal(beta, 1, 'Beta is first now');
  assert.equal(await cdp.evaluate(`document.querySelectorAll('[data-doca-ref="1"]').length`), 1, 'the hidden Alpha no longer holds number 1');
  const r = await run('browser_click', { ref: beta });
  assert.ok(!r.isError, r.said);
  assert.equal(await cdp.evaluate('document.title'), 'b', 'the click reached Beta');

  // Covered by an overlay: said, and not clicked.
  await cdp.evaluate(`document.body.insertAdjacentHTML('beforeend', '<div id="veil" aria-label="A dialog" style="position:fixed;inset:0;background:#0003"></div>')`);
  const covered = await run('browser_click', { ref: beta });
  assert.ok(covered.isError);
  assert.match(covered.said, /is covered: at its centre is div#veil "A dialog"/);
  await cdp.evaluate(`document.getElementById('veil').remove(); document.title = 'start'`);

  // Hidden since the snapshot: said, not clicked at 0,0.
  await cdp.evaluate(`document.getElementById('b').style.display = 'none'`);
  const gone = await run('browser_click', { ref: beta });
  assert.ok(gone.isError);
  assert.match(gone.said, /is not shown on the page now/);
  assert.equal(await cdp.evaluate('document.title'), 'start');

  // A press that ends somewhere else (the control moved away under the mouse): the click went elsewhere, and says so.
  const gamma = refOf((await run('browser_snapshot')).said, 'Gamma');
  const moved = await run('browser_click', { ref: gamma });
  assert.ok(moved.isError, moved.said);
  assert.match(moved.said, /landed on a body, not on \[\d+\]/);
  cdp.ws.close();
});
