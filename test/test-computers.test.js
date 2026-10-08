'use strict';

// Test computers (modules/computers/test-mode.js; the owner's decision of 2026-10-08, self-test #7 option b): a
// computer made for testing takes the agent's own test password and a sign-in click without a person; paying is still
// asked, a saved login never goes in, and only a person marks one, with the password. A fake control server stands in
// for the computer on the hub's side; the computer's own browser tools run against the installed Chromium.

const H = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { findBrowser, devtools } = require('../modules/headless');

let ctl;
const calls = [];

before(async () => {
  ctl = http.createServer((req, res) => {
    let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
      const m = JSON.parse(raw);
      calls.push({ name: m.params.name, args: m.params.arguments });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: m.params.name === 'browser_snapshot' ? 'url: https://github.com/login\n[2] input:password ""' : 'ok' }] } }));
    });
  });
  await new Promise(r => ctl.listen(0, '127.0.0.1', r));
  await H.start();
  const rec = (id, extra = {}) => ({ id, name: id, token: 'tok', fillKey: `fk-${id}`, mcpPort: ctl.address().port, vncPort: 1, createdAt: new Date().toISOString(), ...extra });
  require('../modules/store').writeJson('computers', { computers: [rec('0rd1nary'), rec('k3pt0001', { agentType: 'tester' }), rec('t3st0001', { test: true })] });
  await H.api(null, 'POST', '/api/connectors/logins/all', { label: 'GitHub', site: 'https://github.com', username: 'al', password: 'hunter2-real' });
});
after(async () => { await H.stop(); await new Promise(r => ctl.close(r)); });

test('only a person marks a computer for testing, with the password; never one a specialist keeps', async () => {
  calls.length = 0;
  const asked = await H.api(null, 'POST', '/api/computers/0rd1nary/test', { on: true }, { 'X-Doca-Password': '' });
  assert.equal(asked.status, 401, 'marking asks for the password');
  assert.equal(asked.body.code, 'password_required');
  const ok = await H.api(null, 'POST', '/api/computers/0rd1nary/test', { on: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.test, true);
  assert.deepEqual(calls.at(-1), { name: 'test_mode', args: { on: true, key: 'fk-0rd1nary' } }, 'the computer hears it with the hub\'s key');
  const off = await H.api(null, 'POST', '/api/computers/0rd1nary/test', { on: false }, { 'X-Doca-Password': '' });
  assert.equal(off.status, 200, 'unmarking tightens: no password');
  assert.equal(require('../modules/computers').get('0rd1nary').test, false);
  const kept = await H.api(null, 'POST', '/api/computers/k3pt0001/test', { on: true });
  assert.equal(kept.status, 409);
  assert.match(kept.body.error, /kept for a specialist/);
  assert.equal((await H.api(null, 'POST', '/api/computers', { name: 'x', test: true }, { 'X-Doca-Password': '' })).status, 401, 'making one marked asks too');
});

test('the agent cannot mark a computer that exists, and its list shows the mark', async () => {
  const tools = require('../modules/harness/tools');
  const def = require('../modules/harness/toolbox/computers').find(t => t.name === 'computer');
  assert.ok(!def.parameters.properties.action.enum.some(a => /test|mark/.test(a)), 'no action marks one');
  assert.match(def.parameters.properties.test.description, /^create:/);
  const before = require('../modules/computers').get('0rd1nary').test;
  for (const action of ['test', 'mark', 'start'])
    await tools.call('computer', { action, id: '0rd1nary', test: true }).catch(() => {});
  assert.equal(require('../modules/computers').get('0rd1nary').test, before, 'start with test: true changes nothing');
  const listed = await tools.call('computer', { action: 'list' });
  assert.match(listed, /t3st0001 "t3st0001" .*test computer: sign-ins without asking/);
  assert.doesNotMatch(listed.split('\n').find(l => l.includes('0rd1nary')), /test computer/);
});

test('a saved login is never filled into a test computer', async () => {
  calls.length = 0;
  const out = await require('../modules/harness/tools').call('computer_login', { computer: 't3st0001', login: 'GitHub', userRef: 1, passRef: 2 });
  assert.match(String(out), /test computer: a saved login is never filled into one/);
  assert.equal(calls.length, 0, 'nothing reached the computer');
});

test('paying is asked on every computer, a test one included', () => {
  const g = require('../modules/harness/approval').gate('mcp__computer-t3st0001__browser_click', { ref: 3, confirm: true });
  assert.equal(g?.forced, true);
  assert.equal(g.keys, null);
});

test('signInOnly: a password field and a sign-in pass on a test computer; card, one-time code, paying and deleting do not', () => {
  const { signInOnly } = require('../clients/computer/tools');
  const el = (o = {}) => ({ tagName: 'INPUT', getAttribute: k => o.attrs?.[k] ?? null, ...o });
  const form = sel => ({ querySelector: q => (q.includes(sel) ? {} : null) });
  assert.equal(signInOnly(el({ type: 'password' })), true);
  assert.equal(signInOnly(el({ type: 'text', attrs: { autocomplete: 'new-password' } })), true);
  assert.equal(signInOnly(el({ type: 'text', attrs: { autocomplete: 'cc-number' } })), false);
  assert.equal(signInOnly(el({ type: 'text', attrs: { autocomplete: 'one-time-code' } })), false);
  assert.equal(signInOnly(el({ tagName: 'BUTTON', innerText: 'Sign in' })), true);
  assert.equal(signInOnly(el({ tagName: 'BUTTON', innerText: 'Create account', form: form('password') })), true);
  assert.equal(signInOnly(el({ tagName: 'BUTTON', innerText: 'Continue', form: form('cc-') })), false, 'a card in the form is paying');
  assert.equal(signInOnly(el({ tagName: 'BUTTON', innerText: 'Pay now' })), false);
  assert.equal(signInOnly(el({ tagName: 'BUTTON', innerText: 'Delete account' })), false);
});

// The computer's own tools, in a real Chromium.
const browser = findBrowser();
const PAGE = `<!doctype html><title>start</title><body style="margin:40px">
<form onsubmit="event.preventDefault();document.title='signed in as '+document.getElementById('p').value">
<input id="u" name="user" aria-label="Email"><input id="p" type="password" aria-label="Password"><button>Sign in</button></form>
<form onsubmit="event.preventDefault();document.title='paid'"><input autocomplete="cc-number" aria-label="Card"><button>Pay now</button></form></body>`;

test('in the computer: a test computer types its own password and signs in unasked; an ordinary one still asks; paying always asks',
  { skip: !browser && 'no Chromium here' }, async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-testpc-'));
    const proc = spawn(browser, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--window-size=1000,700', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
    try {
      process.env.CDP_PORT = String(await devtools(profile));
      process.env.FILL_KEY = 'the-hubs-key';
      delete require.cache[require.resolve('../clients/computer/tools')];   // read CDP_PORT again: signInOnly's test loaded it first
      const { TOOLS } = require('../clients/computer/tools');
      const run = async (name, args = {}) => {
        try { const r = await TOOLS.find(t => t.name === name).run(args); return { isError: !!r.isError, said: r.content.map(c => c.text || '').join('') }; }
        catch (e) { return { isError: true, said: e.message }; }
      };
      const refs = async () => Object.fromEntries((await run('browser_snapshot')).said.split('\n')
        .map(l => /^\[(\d+)\] \S+ "([^"]*)"/.exec(l)).filter(Boolean).map(m => [m[2], Number(m[1])]));
      await run('browser_open', { url: `data:text/html,${encodeURIComponent(PAGE)}` });

      // Ordinary: the password field is refused, the sign-in click wants confirm (which the hub always asks a person about).
      let r = await refs();
      assert.match((await run('browser_type', { ref: r.Password, text: 'test-pass-1' })).said, /password or card field/);
      assert.match((await run('browser_click', { ref: r['Sign in'] })).said, /confirm: true/);
      assert.match((await run('test_mode', { on: true, key: 'not-the-key' })).said, /Not the hub/, 'only the hub marks it');

      // A test computer.
      assert.match((await run('test_mode', { on: true, key: 'the-hubs-key' })).said, /test computer/);
      r = await refs();
      assert.equal((await run('browser_type', { ref: r.Email, text: 'tester@example.com' })).isError, false);
      const typed = await run('browser_type', { ref: r.Password, text: 'test-pass-1' });
      assert.equal(typed.isError, false, typed.said);
      const click = await run('browser_click', { ref: r['Sign in'] });
      assert.equal(click.isError, false, click.said);
      const { Cdp } = require('../clients/computer/cdp');
      const cdp = await new Cdp(Number(process.env.CDP_PORT)).connect();
      assert.equal(await cdp.evaluate('document.title'), 'signed in as test-pass-1');
      r = await refs();
      assert.match((await run('browser_type', { ref: r.Card, text: '4242424242424242' })).said, /card field/, 'never a card');
      assert.match((await run('browser_click', { ref: r['Pay now'] })).said, /confirm: true/, 'paying still asks');
      assert.notEqual(await cdp.evaluate('document.title'), 'paid');
    } finally {
      proc.kill();
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* the OS cleans temp */ }
    }
  });
