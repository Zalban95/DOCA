'use strict';

/**
 * Every page shows the version the hub runs (asked 2026-10-10: "the version isn't shown updated unless the app is
 * closed and reopened"; the devices' refresh "should also refresh all the clients' pages"). The live feed's hello names
 * the running version, so a page that reconnects to another one reloads; "Reload every screen" reaches every page (an
 * admin's), "Reload my screens" a person's own; a page with something typed in it asks before it reloads.
 */
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** The live feed as a page reads it. */
function stream(cookie) {
  const ctrl = new AbortController();
  const got = [];
  const waiters = [];
  const ready = fetch(`${H.base}/api/live/stream`, { headers: { Cookie: cookie, Accept: 'text/event-stream' }, signal: ctrl.signal }).then(async res => {
    assert.equal(res.status, 200);
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i); buf = buf.slice(i + 2);
            const data = frame.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('');
            if (!data) continue;
            const c = JSON.parse(data);
            got.push(c);
            waiters.splice(0).forEach(w => w());
          }
        }
      } catch { /* closed */ }
    })();
  });
  const until = async (pred, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const hit = got.find(pred); if (hit) return hit; await new Promise(r => { waiters.push(r); setTimeout(r, 100); }); }
    return null;
  };
  return { ready, got, until, close: () => ctrl.abort() };
}

test('the hello names the running version; reloading reaches whose pages it should', async () => {
  await H.start();
  const member = await H.signIn('member');
  const own = stream(H.owner.cookie), mem = stream(member.cookie);
  try {
    await Promise.all([own.ready, mem.ready]);
    const hello = await own.until(c => c.hello);
    assert.equal(hello.version, require('../package.json').version);
    assert.ok(await mem.until(c => c.hello));

    const asMember = (body) => H.api(null, 'POST', '/api/screen/reload', body, { Cookie: member.cookie, 'X-Doca-Password': '' });
    let r = await asMember({ every: true });
    assert.equal(r.status, 403, 'every screen is an admin\'s');
    r = await asMember({});
    assert.equal(r.status, 200);
    assert.equal(r.body.every, false);
    assert.ok(r.body.pages >= 1, 'their own page counted');
    assert.ok(await mem.until(c => c.topic === 'screen' && c.what === 'reload'), 'their page hears it');
    assert.equal(await own.until(c => c.topic === 'screen' && c.what === 'reload', 600), null, 'nobody else\'s does');

    r = await H.api(null, 'POST', '/api/screen/reload', { every: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.every, true);
    assert.ok(r.body.pages >= 2);
    const heard = await own.until(c => c.topic === 'screen' && c.what === 'reload' && c.every);
    assert.ok(heard);
    assert.ok(await mem.until(c => c.topic === 'screen' && c.what === 'reload' && c.every), 'every page of the hive');

    r = await H.api(null, 'POST', '/api/screen/reload', {}, { Cookie: '' });
    assert.ok([401, 403].includes(r.status), 'nobody signed in reloads nothing');
  } finally { own.close(); mem.close(); await H.stop(); }
});

/** lib/page-reload.js in a sandbox: what it does when the version changes, free and busy. */
function sandbox() {
  const reloads = [], shown = [];
  const field = { isConnected: true, type: 'text', value: '', defaultValue: '', matches: () => true };
  const el = () => ({ appendChild(c) { shown.push(c.textContent || ''); return c; }, append(...cs) { cs.forEach(c => shown.push(c.textContent || '')); }, setAttribute() {}, remove() {}, isConnected: true, set innerHTML(_) {} });
  const listeners = {};
  const ctx = {
    location: { reload: () => reloads.push(1) },
    setTimeout: fn => { if (ctx.fire) fn(); return 1; }, clearTimeout: () => {},
    document: { body: el(), getElementById: () => null, querySelector: () => null, createElement: el, addEventListener: (t, fn) => { listeners[t] = fn; } },
  };
  ctx.fire = true;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public/js/lib/page-reload.js'), 'utf8'), ctx);
  const type = v => { field.value = v; listeners.input({ isTrusted: true, target: field }); };
  return { ctx, reloads, shown, type };
}

test('a page reloads when the hub runs another version, unless something typed would be lost', () => {
  const s = sandbox();
  s.ctx.pageVersionSeen('3.19.0');
  s.ctx.pageVersionSeen('3.19.0');
  assert.equal(s.reloads.length, 0, 'the same version: nothing');
  s.ctx.pageVersionSeen('3.20.0');
  assert.equal(s.reloads.length, 1, 'another version: it loads again');

  const busy = sandbox();
  busy.ctx.fire = false;   // the 10 s re-check is not run here
  busy.type('half a message');
  busy.ctx.pageVersionSeen('3.19.0');
  busy.ctx.pageVersionSeen('3.20.0');
  assert.equal(busy.reloads.length, 0, 'what was typed is not thrown away');
  assert.ok(busy.shown.some(t => /updated to v3\.20\.0/.test(t) && /typed/.test(t)), 'it says why it waits');
  assert.ok(busy.shown.includes('Reload'), 'and offers the button');
  assert.match(busy.ctx.pageReloadBusy(), /typed/);
  busy.type('');
  assert.equal(busy.ctx.pageReloadBusy(), '', 'cleared: free to reload');
});
