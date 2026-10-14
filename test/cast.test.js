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
  assert.match(tv.location, /^\/\?view=live&cast=1#vs=[A-Za-z0-9_-]{20,}$/, 'the page, with its session in the fragment (R3i)');
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
test('every castable page draws through a view link, locked, with no script error', { skip: !headless.findBrowser() && 'no browser here', timeout: 900000 }, async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
  /** One try at a page through a fresh view link: what it shows, its errors and the loads that failed. */
  const attempt = async page => {
    const l = (await H.api(null, 'POST', '/api/cast/links', { page })).body;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-cast-'));
    const proc = spawn(headless.findBrowser(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', ...headless.ALONE,
      '--disable-gpu', '--window-size=1400,900', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
    try {
      const cdp = await headless.connect(await headless.devtools(profile));
      const errors = [], failed = [], urls = new Map();   // failed: loads the network dropped (a cast screen's refused routes are its rule, not a failure)
      cdp.on(m => {
        if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
        if (m.method === 'Network.requestWillBeSent') urls.set(m.params.requestId, m.params.request.url);
        if (m.method === 'Network.loadingFailed' && !m.params.canceled) failed.push(`${m.params.errorText} ${String(urls.get(m.params.requestId) || '').replace(H.base, '')}`);
      });
      await cdp.send('Runtime.enable');
      await cdp.send('Network.enable');
      await cdp.send('Page.navigate', { url: `${H.base}${l.path}` });
      const ask = e => cdp.send('Runtime.evaluate', { expression: e, returnByValue: true }).then(r => r.result.value);
      let where = '';
      // Up to a minute: under a full run's load, or on Windows CI, the panel's boot took past thirty seconds.
      for (let i = 0; i < 200 && !/cast-view|face/.test(where); i++) {
        await headless.sleep(300);
        where = await ask("location.pathname + ' ' + document.body.className + ' | ' + location.search + ' | ' + document.title + ' | ' + document.readyState") || '';
      }
      await headless.sleep(1500);
      const why = await ask("JSON.stringify({ soloOn: typeof soloOn === 'function' ? soloOn() : 'absent', fab: !!document.getElementById('chat-fab'), solo: document.body.classList.contains('solo'), tab: typeof currentTab !== 'undefined' ? currentTab : null })");
      const back = await ask("!!document.querySelector('.solo-bar button[title^=\"Back\"]')");
      cdp.close?.();
      return { where, why, back, errors, failed };
    } finally {
      const gone = new Promise(r => proc.once('exit', r)); proc.kill(); await gone;
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left in the temp folder */ }
    }
  };
  for (const page of Object.keys(require('../modules/cast/views').VIEWS)) {
    // The machine's network changing under the browser (another test starting a container adds an interface) cancels
    // its loads with net::ERR_NETWORK_CHANGED — not the panel: that page is tried again, at most twice.
    let r;
    for (let i = 0; i < 3; i++) { r = await attempt(page); if (!r.failed.some(f => /ERR_NETWORK_CHANGED/.test(f))) break; }
    assert.ok((page === 'face' ? /\/face/ : /cast-view/).test(r.where), `${page}: ${r.where} — ${r.why} — errors: ${r.errors.join(' | ') || 'none'} — failed loads: ${r.failed.slice(0, 12).join(' | ') || 'none'}`);
    assert.equal(r.back, false, `${page}: no way back to the whole panel`);
    assert.deepEqual(r.errors, [], page);
  }
});

test('a cast screen with no session is told so, never sent to sign in (a receiver that keeps no cookie, 2026-10-13)', async () => {
  const r = await fetch(`${H.base}/?view=ambient&cast=1`, { redirect: 'manual' });
  assert.equal(r.status, 401);
  assert.match(await r.text(), /no longer signed in to show the page/);
  const plain = await fetch(`${H.base}/?view=ambient`, { redirect: 'manual' });
  assert.equal(plain.status, 302, 'anyone else is still sent to sign in');
});

test('the remote: a key reaches only the screen it is for, as its live feed; a wrong key or someone else\'s screen is refused', async () => {
  await H.api(null, 'GET', '/api/screen');
  const mine = (await H.api(null, 'GET', '/api/cast/targets')).body.targets.find(t => t.mine);
  const heard = [];
  const on = c => { if (c.topic === 'screen' && c.what === 'key') heard.push(c); };
  require('../modules/live').feed.on('change', on);
  const r = await H.api(null, 'POST', '/api/cast/remote', { screen: mine.id, key: 'down' });
  require('../modules/live').feed.off('change', on);
  assert.equal(r.status, 200);
  assert.deepEqual(heard.map(c => [c.id, c.key]), [[mine.id, 'down']]);
  assert.equal((await H.api(null, 'POST', '/api/cast/remote', { screen: mine.id, key: 'reboot' })).status, 400);
  const member = await H.signIn('member', 'cast-remote@test.local');
  assert.equal((await H.api(null, 'POST', '/api/cast/remote', { screen: mine.id, key: 'ok' }, { Cookie: member.cookie })).status, 404, 'not theirs');
  assert.equal((await H.api(null, 'POST', '/api/cast/things/nope/remote', { key: 'ok' })).status, 404, 'no such TV');
});

test('from the Wi-Fi, a cast screen reads its one page; anything else of the machine\'s is still refused there', async () => {
  const link = await H.api(null, 'POST', '/api/cast/links', { page: 'live', name: 'TV on the Wi-Fi' });
  const tv = await openLink(link.body.path);
  const network = require('../modules/network'), was = { limited: network.limited, rightsFrom: network.rightsFrom };
  network.limited = (req, right) => network.MACHINE.has(right);   // every request as if from the local network
  network.rightsFrom = (req, rights) => rights.filter(r => !network.MACHINE.has(r));
  try {
    assert.equal((await as(tv.cookie, 'GET', '/api/machines/rows')).status, 200, 'what Live reads, from the Wi-Fi');
    assert.ok((await as(tv.cookie, 'GET', '/api/auth/me')).body.rights.includes('host'), 'drawn with the caster\'s rights');
    assert.equal((await as(tv.cookie, 'GET', '/api/settings/leaves')).status, 403, 'not its page');
    const owner = await H.api(null, 'GET', '/api/machines/rows');
    assert.equal(owner.status, 403, 'an ordinary session from the Wi-Fi is limited as before');
    assert.equal(owner.body.reason, 'outside_tailnet');
  } finally { Object.assign(network, was); }
});
