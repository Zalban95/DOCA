'use strict';

/**
 * A plan contract's look at a page as a person would see it (plan-contracts.js `{page}`): the hub's headless browser
 * (modules/headless.js) opens the address, lets it settle, and reports whether the rendered page holds a text or an
 * element and whether its console stayed free of errors — what "the page shows the chair" means, where an address
 * that merely answers would pass a blank canvas (the live model's own review of contracts, 2026-10-07).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

async function look(url, { contains, selector, settleMs = 2500, timeoutMs = 30000 } = {}) {
  const h = require('../headless');
  const exe = h.findBrowser();
  if (!exe) return { ok: false, why: 'no Chrome, Edge or Chromium on this machine to look at the page (Settings → System → System tools)' };
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-check-'));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...h.ALONE,
    '--ignore-certificate-errors', '--disable-gpu', '--window-size=1280,800', '--mute-audio',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });   // as shots.js and the smoke start it
  const errors = [];
  let page = null;
  const done = r => { try { page?.close(); } catch { /* gone */ } try { proc.kill(); } catch { /* gone */ } setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the OS cleans it */ } }, 500).unref(); return r; };
  const timer = new Promise(resolve => { const t = setTimeout(() => resolve({ ok: false, why: `${url} did not finish loading in ${Math.round(timeoutMs / 1000)} s` }), timeoutMs); t.unref(); });
  const work = (async () => {
    page = await h.connect(await h.devtools(profile));
    page.on(m => {
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'an exception');
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
      if (m.method === 'Log.entryAdded' && m.params.entry?.level === 'error') errors.push(m.params.entry.text);
    });
    await page.send('Runtime.enable'); await page.send('Log.enable'); await page.send('Page.enable');
    await page.send('Page.navigate', { url });
    await h.sleep(settleMs);
    const probe = `(() => ({ text: document.body ? document.body.innerText : '', has: ${selector ? `!!document.querySelector(${JSON.stringify(selector)})` : 'true'} }))()`;
    const r = (await page.send('Runtime.evaluate', { expression: probe, returnByValue: true })).result?.value || {};
    return { text: String(r.text || ''), has: r.has !== false, errors: errors.filter(Boolean).slice(0, 5) };
  })();
  try {
    const seen = await Promise.race([work, timer]);
    if (seen.ok === false) return done(seen);
    if (contains && !seen.text.includes(contains)) return done({ ok: false, why: `the page at ${url} does not show "${contains}"` });
    if (selector && !seen.has) return done({ ok: false, why: `the page at ${url} has no ${selector}` });
    return done({ ok: true, why: `${url} rendered${contains ? ` with "${contains}"` : ''}${selector ? ` and ${selector}` : ''}`, errors: seen.errors });
  } catch (e) { return done({ ok: false, why: `could not look at ${url}: ${e.message}` }); }
}

module.exports = { look };
