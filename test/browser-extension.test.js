'use strict';

// DOCA in a browser (clients/browser; TODO H5.5): the extension's MCP server against a fake browser — only sites the
// person allowed, a page read as the open world, decisions and secrets refused the computer's way — and the hub
// handing out the extension and pairing it with the narrow `extension` preset.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const mcp = require('../clients/browser/mcp');
const page = require('../clients/browser/page');

before(() => H.start());
after(() => H.stop());

/** A browser with two tabs; example.com allowed, bank.example not. */
function fakeEnv() {
  const calls = [];
  const tabs = [{ id: 1, title: 'Example', url: 'https://example.com/a', active: true }, { id: 2, title: 'Bank', url: 'https://bank.example/home', active: false }];
  return { calls, tabs: async () => tabs, tab: async id => tabs.find(t => t.id === id) || null,
    allowed: async url => new URL(url).origin === 'https://example.com',
    open: async url => { calls.push(['open', url]); return { id: 3, url }; },
    page: async (id, fn, ...args) => { calls.push([fn, id, ...args]); return fn === 'snapshot' ? 'title: Example\n[1] button "Pay now"' : fn === 'click' ? (args[1] ? { ok: true, text: 'Clicked [1].' } : { ok: false, error: '[1] is "Pay now" — … confirm: true' }) : true; },
    screenshot: async () => 'iVBOR', back: async id => calls.push(['back', id]) };
}
const call = (env, name, args, paused) => mcp.handle(env, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, paused).then(r => r.result);

test('a manifest both Chromium and Firefox load, asking for no site up front', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../clients/browser/manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.background.service_worker, 'background.js', 'Chromium');
  assert.deepEqual(m.background.scripts, ['page.js', 'mcp.js', 'background.js'], 'Firefox');
  assert.ok(!m.host_permissions, 'no site is granted at install: each one is the person\'s yes');
  assert.deepEqual(m.optional_host_permissions, ['https://*/*', 'http://*/*']);
  for (const f of ['background.js', 'page.js', 'mcp.js', 'popup.html', 'popup.js']) assert.ok(fs.existsSync(path.join(__dirname, '../clients/browser', f)), f);
});

test('the tools: a page reads as the open world; nothing on a site the person did not allow', async () => {
  const list = (await mcp.handle(fakeEnv(), { jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
  assert.equal(list.find(t => t.name === 'browser_snapshot').annotations.openWorldHint, true);
  const env = fakeEnv();
  assert.match((await call(env, 'browser_tabs', {})).content[0].text, /1 \(in front\)\s+allowed[\s\S]*2\s+not allowed/);
  assert.equal((await call(env, 'browser_open', { url: 'https://bank.example/transfer' })).isError, true);
  assert.match((await call(env, 'browser_snapshot', { tab: 2 })).content[0].text, /bank\.example is not a site the person let DOCA use/);
  assert.match((await call(env, 'browser_snapshot', {})).content[0].text, /Pay now/);
  assert.deepEqual(env.calls.slice(0, 2).map(c => c[0]), ['mark', 'snapshot'], 'the page shows DOCA is using it');
  assert.equal((await call(env, 'browser_click', { ref: 1 })).isError, true, 'a decision without confirm is refused in the page');
  assert.equal((await call(env, 'browser_click', { ref: 1, confirm: true })).content[0].text, 'Clicked [1].');
  assert.match((await call(env, 'browser_open', { url: 'https://example.com/b' })).content[0].text, /Opened tab 3/);
  assert.match((await call(env, 'browser_tabs', {}, true)).content[0].text, /paused/);
});

test('the page\'s rules are the computer\'s: secrets and decisions classified alike', () => {
  const computer = require('../clients/computer/tools').sensitive;
  const el = (o = {}) => ({ tagName: 'INPUT', getAttribute: k => o.attrs?.[k] ?? null, ...o });
  const formWith = secret => ({ querySelector: () => (secret ? {} : null) });
  for (const e of [el({ type: 'password' }), el({ type: 'text', attrs: { autocomplete: 'cc-number' } }), el({ tagName: 'BUTTON', innerText: 'Pay now' }),
    el({ tagName: 'A', innerText: 'Sign in' }), el({ tagName: 'BUTTON', innerText: 'Continue', form: formWith(true) }),
    el({ tagName: 'BUTTON', innerText: 'Continue', form: formWith(false) }), el({ tagName: 'A', innerText: 'Pricing' })])
    assert.deepEqual(page.sensitive(e), computer(e));
  // A password field is never typed into, even when asked to confirm.
  const doc = { querySelector: () => el({ type: 'password' }) };
  assert.match(page.type(1, 'hunter2', false, true, doc).error, /password or card field/);
});

test('the hub hands out the extension and pairs it with a preset that lends tabs and nothing else', async () => {
  const r = await fetch(`${H.base}/api/clients/browser.zip`, { headers: { Cookie: H.owner.cookie } });
  assert.equal(r.status, 200);
  const files = require('../modules/packs/zip').read(Buffer.from(await r.arrayBuffer()));
  assert.ok(files.some(f => f.name === 'doca-browser/manifest.json'));
  assert.deepEqual(require('../modules/api-v1/scopes').PRESETS.extension, ['mcp:self']);
  const d = { kind: 'device', caps: { formFactor: 'desktop', ext: { client: 'doca-browser' } } };
  assert.equal(require('../modules/devices-panel').presetFor(d), 'extension', 'not reported as lacking a phone\'s scopes');
});
