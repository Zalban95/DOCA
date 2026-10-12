'use strict';

// Casting (modules/cast; docs/design/cast-and-devices.md; the owner's yes of 2026-10-12): a view link opens once and
// makes a screen that shows one page read-only, as the person who cast it — only what that page reads, no socket, no
// change; Stop signs it out. And a person casts to their own screens, kept there when asked.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

before(() => H.start());
after(() => H.stop());

/** Opens a view link as a TV's browser would: no cookie, follows nothing; returns the screen's cookie header. */
async function openLink(path) {
  const r = await fetch(`${H.base}${path}`, { redirect: 'manual' });
  const cookies = (r.headers.getSetCookie?.() || [r.headers.get('set-cookie')]).filter(Boolean).map(c => c.split(';')[0]);
  return { status: r.status, location: r.headers.get('location'), cookie: cookies.join('; ') };
}
const as = (cookie, method, path, body) => H.api(null, method, path, body, { Cookie: cookie, 'X-Doca-Password': '' });

test('a view link opens once, on a screen of its own, and shows its one page read-only', async () => {
  const link = await H.api(null, 'POST', '/api/cast/links', { page: 'live', name: 'Living room TV' });
  assert.equal(link.status, 200);
  const tv = await openLink(link.body.path);
  assert.equal(tv.status, 302);
  assert.equal(tv.location, '/?view=live');
  assert.equal((await openLink(link.body.path)).status, 410, 'once only');

  const me = await as(tv.cookie, 'GET', '/api/auth/me');
  assert.equal(me.body.view, 'live');
  assert.equal((await as(tv.cookie, 'GET', '/api/machines/rows')).status, 200, 'what Live reads, as the person who cast it');
  for (const [method, path] of [['GET', '/api/prefs'], ['GET', '/api/chat/history'], ['GET', '/api/notices'], ['POST', '/api/home/call'],
    ['POST', '/api/harness/chat'], ['GET', '/api/files/list'], ['GET', '/api/machines/vms/libvirt/x/console']]) {
    const r = await as(tv.cookie, method, path, method === 'GET' ? undefined : {});
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.body.code, 'view_only');
  }
  const ws = { headers: { cookie: tv.cookie, host: 'x' }, socket: {} };
  assert.equal(require('../modules/auth/gate').upgradeAllowed(ws, 'host'), null, 'no console, no terminal, no call');

  // Stop: the screen it made is signed out.
  const screen = require('../modules/api-v1/devices').list().find(d => d.cast?.view && d.name === 'Living room TV');
  assert.ok(screen);
  assert.equal((await H.api(null, 'POST', '/api/cast/stop', { screen: screen.id })).body.signedOut, true);
  assert.equal((await as(tv.cookie, 'GET', '/api/auth/me')).status, 401);
});

test('a link is for a page a screen can show; a person casts only to their own screens, kept there when asked', async () => {
  assert.equal((await H.api(null, 'POST', '/api/cast/links', { page: 'settings' })).status, 400);
  // The owner's own browser screen (made by asking /api/screen with a cookie).
  await H.api(null, 'GET', '/api/screen');
  const mine = (await H.api(null, 'GET', '/api/cast/targets')).body.targets.find(t => t.mine);
  assert.ok(mine);
  const sent = await H.api(null, 'POST', '/api/cast/show', { screen: mine.id, page: 'workstream', keep: true });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.screen.cast.keep, true);
  const member = await H.signIn('member', 'cast-member@test.local');
  assert.equal((await H.api(null, 'POST', '/api/cast/show', { screen: mine.id, page: 'ambient' }, { Cookie: member.cookie })).status, 404, 'not theirs');
});

// In a real browser, as a TV opens it: each page a screen can be given draws through its view link alone, locked to
// it, with no script error — the list of what it reads (cast/views.js) is held to what the page really reads.
const headless = require('../modules/headless');
test('every castable page draws through a view link, locked, with no script error', { skip: !headless.findBrowser() && 'no browser here', timeout: 200000 }, async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
  for (const page of Object.keys(require('../modules/cast/views').VIEWS)) {
    const l = (await H.api(null, 'POST', '/api/cast/links', { page })).body;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-cast-'));
    const proc = spawn(headless.findBrowser(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', ...headless.ALONE,
      '--disable-gpu', '--window-size=1400,900', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
    try {
      const cdp = await headless.connect(await headless.devtools(profile));
      const errors = [];
      cdp.on(m => { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
      await cdp.send('Runtime.enable');
      await cdp.send('Page.navigate', { url: `${H.base}${l.path}` });
      let where = '';
      for (let i = 0; i < 100 && !/cast-view|face/.test(where); i++) {
        await headless.sleep(300);
        where = (await cdp.send('Runtime.evaluate', { expression: "location.pathname + ' ' + document.body.className", returnByValue: true })).result.value || '';
      }
      await headless.sleep(1500);
      assert.match(where, page === 'face' ? /\/face/ : /cast-view/, `${page}: ${where}`);
      const back = (await cdp.send('Runtime.evaluate', { expression: "!!document.querySelector('.solo-bar button[title^=\"Back\"]')", returnByValue: true })).result.value;
      assert.equal(back, false, `${page}: no way back to the whole panel`);
      assert.deepEqual(errors, [], page);
      cdp.close?.();
    } finally {
      const gone = new Promise(r => proc.once('exit', r)); proc.kill(); await gone;
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left in the temp folder */ }
    }
  }
});
