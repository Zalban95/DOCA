'use strict';

// Logins for the agents' computers (modules/logins.js; TODO H5.4): a vault whose passwords the agent never sees. A
// fake control server stands in for the computer; the real snapshot script is checked in test/browser-decisions.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');

let ctl, page = 'https://github.com/login';
const calls = [];

before(async () => {
  ctl = http.createServer((req, res) => {
    let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
      const m = JSON.parse(raw);
      calls.push({ auth: req.headers.authorization, name: m.params.name, args: m.params.arguments });
      const text = m.params.name === 'browser_snapshot' ? `title: Sign in\nurl: ${page}\n\n[1] input:text "Username"\n[2] input:password ""` : 'ok';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text }] } }));
    });
  });
  await new Promise(r => ctl.listen(0, '127.0.0.1', r));
  await H.start();
  const store = require('../modules/store');
  store.writeJson('computers', { computers: [
    { id: 'c0ffee01', name: 'test', token: 'tok', fillKey: 'fk-secret', mcpPort: ctl.address().port, vncPort: 1, createdAt: new Date().toISOString() },
    { id: 'c0ffee02', name: 'old', token: 'tok', mcpPort: ctl.address().port, vncPort: 1, createdAt: new Date().toISOString() }] });
});
after(async () => { await H.stop(); await new Promise(r => ctl.close(r)); });

test('the owner keeps a login; its password never reads back, and the file is the owner\'s alone', async () => {
  const r = await H.api(null, 'POST', '/api/connectors/logins/all', { label: 'GitHub', site: 'https://github.com/login', username: 'al', password: 'hunter2-real' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.login.site, 'https://github.com', 'the site is an origin');
  const list = await H.api(null, 'GET', '/api/connectors/logins/all');
  assert.ok(!JSON.stringify(list.body).includes('hunter2'));
  const paths = require('../modules/paths');
  assert.ok(paths.PROTECTED_FILES.includes(paths.LOGIN_KEYS_FILE));
  if (process.platform !== 'win32') assert.equal(fs.statSync(paths.LOGIN_KEYS_FILE).mode & 0o777, 0o600);
  assert.equal((await H.api(null, 'POST', '/api/connectors/logins/all', { site: 'nope', password: 'x' })).status, 400);
  // In the readings since 2.250.0 (turn/fits.js), not the tool's description.
  assert.match(require('../modules/harness/turn/fits').inventory(new Set(['computer_login'])), /Logins for computer_login: GitHub \(https:\/\/github\.com\)/, 'the agent reads which logins exist, never their secrets');
});

test('signing in: the hub types the password with its key; the agent\'s answer never holds it', async () => {
  calls.length = 0;
  const out = await require('../modules/harness/tools').call('computer_login', { computer: 'c0ffee01', login: 'GitHub', userRef: 1, passRef: 2 });
  assert.match(out, /Filled the sign-in for GitHub as al/);
  assert.ok(!out.includes('hunter2'));
  assert.deepEqual(calls.map(c => c.name), ['browser_snapshot', 'browser_type', 'browser_fill_secret']);
  assert.deepEqual(calls[1].args, { ref: 1, text: 'al' });
  assert.deepEqual(calls[2].args, { ref: 2, value: 'hunter2-real', key: 'fk-secret' }, 'only the hub\'s call carries the secret and the key');
  assert.ok(calls.every(c => c.auth === 'Bearer tok'));
});

test('a look-alike site, an unknown login or an older computer gets nothing', async () => {
  page = 'https://github.com.evil.example/login';
  calls.length = 0;
  assert.match(await require('../modules/harness/tools').call('computer_login', { computer: 'c0ffee01', login: 'GitHub', userRef: 1, passRef: 2 }), /not https:\/\/github\.com.*only on its own site/);
  assert.ok(!calls.some(c => c.name === 'browser_fill_secret'));
  page = 'https://github.com/login';
  assert.match(await require('../modules/harness/tools').call('computer_login', { computer: 'c0ffee01', login: 'Gitlab', passRef: 2 }), /No login "Gitlab"/);
  assert.match(await require('../modules/harness/tools').call('computer_login', { computer: 'c0ffee02', login: 'GitHub', passRef: 2 }), /made before logins existed/);
});

test('using a login is asked every time, in every mode, and never "always"', () => {
  const g = require('../modules/harness/approval').gate('computer_login', { computer: 'c0ffee01', login: 'GitHub', passRef: 2 });
  assert.equal(g.forced, true);
  assert.equal(g.keys, null);
  assert.ok(!g.summary.includes('hunter2'));
});

test('the password goes only into a password field: a text field would show it in the next snapshot', async () => {
  calls.length = 0;
  const out = await require('../modules/harness/tools').call('computer_login', { computer: 'c0ffee01', login: 'GitHub', passRef: 1 });
  assert.match(out, /\[1\] is not a password field/);
  assert.ok(!calls.some(c => c.name === 'browser_fill_secret'));
});

test('a login is an admin\'s: a member\'s turn needs it allotted, on a computer of their own', async () => {
  const tools = require('../modules/harness/tools'), memory = require('../modules/harness/memory');
  const m = await H.signIn('member', 'logins-member@test.local');
  const user = { ...m.user, role: 'member' };
  const own = memory.createSession('member work', { activate: false });
  require('../modules/harness/session-access').claim(user, own.id);
  const store = require('../modules/store');
  const rows = store.readJson('computers', { computers: [] }).computers;
  store.writeJson('computers', { computers: [...rows, { ...rows[0], id: 'c0ffee03', name: 'theirs', by: own.id }] });
  calls.length = 0;
  assert.match(await tools.call('computer_login', { computer: 'c0ffee03', login: 'GitHub', passRef: 2 }, [], { user }), /does not have the login GitHub allotted/);
  const id = require('../modules/logins').list().find(l => l.label === 'GitHub').id;
  require('../modules/auth/grants').create({ subject: { kind: 'user', id: user.id }, permission: `use:login:${id}`, by: { kind: 'user', id: H.owner.user.id } });
  assert.match(await tools.call('computer_login', { computer: 'c0ffee01', login: 'GitHub', passRef: 2 }, [], { user }), /not .*'s: an agent acts only on a computer its person made/, 'not on the owner\'s computer');
  assert.ok(!calls.some(c => c.name === 'browser_fill_secret'));
  assert.match(await tools.call('computer_login', { computer: 'c0ffee03', login: 'GitHub', passRef: 2 }, [], { user }), /Filled the sign-in for GitHub/, 'allotted, on their own computer');
});
