'use strict';

/**
 * Pages for the System 1 measurement (docs/experiments/system-one.md): a throwaway DOCA panel (the smoke test's own
 * child, on temp data) opened in the installed headless browser, each page read with the agents' computer's own
 * browser_snapshot script (clients/computer/tools.js SNAPSHOT), and a goal on it labelled with the element that reaches
 * it. Written to bin/lib/system-one-pages.json, so the measurement runs the same pages every time:
 *   npm run experiment -- system-one --capture
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { findBrowser, devtools, connect, sleep, ALONE } = require('../../modules/headless');

const OUT = path.join(__dirname, 'system-one-pages.json');

/**
 * Each page: how to get there (an expression in the panel), then goals with the element that reaches each — a pattern
 * on the snapshot's line for it — and how it is used. Labelled by hand from the snapshots (`--capture --show`).
 */
const PAGES = require('./system-one-goals');

async function capture({ show = false } = {}) {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('No Chrome, Edge or Chromium found — set CHROME.');
  const smoke = path.join(__dirname, '..', 'doca-smoke.js');
  // As on a fresh install: no container CLI and nothing else on PATH, so no page lists this machine's own containers.
  const env = { ...process.env, PATH: path.dirname(process.execPath), DOCA_CONTAINER_CLI: 'none' };
  const child = spawn(process.execPath, [smoke, '--serve'], { stdio: ['ignore', 'pipe', 'inherit'], env });
  const { base, cookie, data } = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', d => { buf += d; const line = buf.split('\n').find(l => l.startsWith('{')); if (line) resolve(JSON.parse(line)); });
    child.on('exit', code => reject(new Error(`the panel did not start (exit ${code})`)));
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-s1-'));
  const proc = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', ...ALONE,
    '--disable-gpu', '--window-size=1300,900', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
  const out = [], pages = {};
  try {
    const cdp = await connect(await devtools(profile));
    const ev = async expression => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
    await cdp.send('Network.enable');
    const [name, value] = cookie.split('=');
    await cdp.send('Network.setCookie', { name, value, url: base });
    await cdp.send('Page.navigate', { url: `${base}/` });
    for (let i = 0; i < 60 && !(await ev("typeof NAV_TABS !== 'undefined' && document.readyState === 'complete'")); i++) await sleep(500);
    await ev("typeof guidedWelcomeChoose === 'function' && guidedWelcomeChoose('advanced')");   // the first-run choice, answered
    await sleep(1500);
    const { SNAPSHOT } = require('../../clients/computer/tools');
    for (const page of PAGES) {
      await ev(page.go); await sleep(page.wait || 1200);
      const snapshot = String(await ev(SNAPSHOT)).replace(base, 'https://hub.example').split(base).join('https://hub.example');
      const trimmed = snapshot.replace(/(--- text ---\n)([\s\S]*)$/, (m, h, t) => h + t.slice(0, 1500));
      pages[page.name] = trimmed;
      if (show) console.log(`\n===== ${page.name}\n${trimmed.split('--- text ---')[0].split('\n').filter(l => !/^\[\d+\] (button:submit|a) "(USE|↻|⚙|▶ OPEN|docs)"/.test(l)).join('\n')}`);
      for (const g of page.goals) {
        const answer = trimmed.split('\n').filter(l => /^\[\d+\]/.test(l) && new RegExp(g.match, 'i').test(l)).map(l => Number(l.match(/^\[(\d+)\]/)[1]));
        if (!answer.length) console.error(`  ${page.name}: no element matches ${g.match} for "${g.goal}"`);
        out.push({ page: page.name, goal: g.goal, how: g.how || 'click', answer });
      }
    }
    cdp.close();
  } finally {
    proc.kill(); child.kill('SIGKILL'); await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* temp */ }
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* temp */ }
  }
  const usable = out.filter(c => c.answer.length);
  fs.writeFileSync(OUT, `${JSON.stringify({ captured: new Date().toISOString().slice(0, 10), pages, cases: usable }, null, 1)}\n`);
  return { cases: usable.length, skipped: out.length - usable.length, file: OUT };
}

module.exports = { capture, OUT };
