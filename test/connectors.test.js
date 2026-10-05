'use strict';

// OAuth connectors (modules/connectors, TODO H9.3): a stub OAuth 2.0 service that checks PKCE, issues tokens that
// expire, refreshes them, and serves an API. A connection is the tool connector_<id>, only to that service's API,
// host-only unless opened; no secret ever reaches a browser; the callback is guarded by its one-time state.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');

let svc, base;
const codes = new Map(), seen = { refreshes: 0, auth: [] };
let issued = 0;
const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

before(async () => {
  svc = http.createServer((req, res) => {
    let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const json = (j, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (u.pathname === '/token') {
        const f = Object.fromEntries(new URLSearchParams(raw));
        if (f.client_id !== 'cid' || f.client_secret !== 'csecret') return json({ error: 'invalid_client' }, 401);
        if (f.grant_type === 'authorization_code') {
          const c = codes.get(f.code);
          if (!c || b64url(crypto.createHash('sha256').update(f.code_verifier || '').digest()) !== c.challenge) return json({ error: 'invalid_grant', error_description: 'PKCE check failed' }, 400);
          codes.delete(f.code);
          return json({ access_token: `at${++issued}`, refresh_token: 'rt1', expires_in: 30, scope: 'read write' });   // expires within the minute: refreshed on use
        }
        if (f.grant_type === 'refresh_token' && f.refresh_token === 'rt1') { seen.refreshes++; return json({ access_token: `at${++issued}`, expires_in: 3600 }); }
        return json({ error: 'unsupported_grant_type' }, 400);
      }
      seen.auth.push(req.headers.authorization);
      if (u.pathname === '/api/me') return json({ login: 'al-on-stub' });
      if (u.pathname === '/api/issues') return json([{ title: 'Printer offline', by: 'someone else' }, { method: req.method, q: u.searchParams.get('state') }]);
      return json({ message: 'Not Found' }, 404);
    });
  });
  await new Promise(r => svc.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${svc.address().port}`;
  await H.start();
});
after(async () => { await H.stop(); await new Promise(r => svc.close(r)); });

/** What a person's browser does: open the authorize address, and come back with the code the service gives. */
function authorize(url) {
  const u = new URL(url);
  const code = crypto.randomBytes(6).toString('hex');
  codes.set(code, { challenge: u.searchParams.get('code_challenge') });
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  return { state: u.searchParams.get('state'), code, redirect: u.searchParams.get('redirect_uri') };
}

test('a custom service is set up with the owner\'s app; nothing secret reads back', async () => {
  const r = await H.api(null, 'POST', '/api/connectors/stub', { label: 'Stub Hub', clientId: 'cid', clientSecret: 'csecret', scopes: 'read write',
    urls: { authorize: `${base}/authorize`, token: `${base}/token`, api: [`${base}/api`], whoami: `${base}/api/me` } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const list = await H.api(null, 'GET', '/api/connectors');
  assert.match(list.body.callback, /\/api\/connectors\/callback$/);
  assert.deepEqual(list.body.connectors.map(c => c.id), ['github', 'google', 'microsoft', 'stub']);
  assert.ok(!JSON.stringify(list.body).includes('csecret'), 'the secret never reads back');
  assert.equal(list.body.connectors.find(c => c.id === 'stub').hasSecret, true);
  if (process.platform !== 'win32') assert.equal(fs.statSync(require('../modules/paths').CONNECTOR_KEYS_FILE).mode & 0o777, 0o600);
  assert.ok(require('../modules/paths').PROTECTED_FILES.includes(require('../modules/paths').CONNECTOR_KEYS_FILE), 'out of the file tools\' reach');
  const member = await H.signIn('member', 'conn-member@test.local');
  assert.equal((await H.api(null, 'GET', '/api/connectors', undefined, { Cookie: member.cookie })).status, 403);
  assert.equal((await H.api(null, 'POST', '/api/connectors/bad', { urls: { authorize: 'javascript:alert(1)' } })).status, 400);
});

test('connecting: PKCE through the service, back to the callback — with no cookie, guarded by its state', async () => {
  assert.ok(!require('../modules/harness/tools').schemas().some(t => t.function.name === 'connector_stub'), 'no tool before it is connected');
  const start = await H.api(null, 'POST', '/api/connectors/stub/connect');
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const { state, code, redirect } = authorize(start.body.url);
  assert.match(redirect, /\/api\/connectors\/callback$/);
  const forged = await fetch(`${H.base}/api/connectors/callback?state=nope&code=${code}`);
  assert.match(await forged.text(), /unknown or has expired/);
  const back = await fetch(`${H.base}/api/connectors/callback?state=${state}&code=${code}`);   // no cookie: the service's redirect
  assert.match(await back.text(), /Stub Hub as al-on-stub is connected/);
  const again = await fetch(`${H.base}/api/connectors/callback?state=${state}&code=${code}`);
  assert.match(await again.text(), /unknown or has expired/, 'a state works once');
  const c = (await H.api(null, 'GET', '/api/connectors')).body.connectors.find(x => x.id === 'stub');
  assert.deepEqual([c.connected, c.account, c.refreshable], [true, 'al-on-stub', true]);
  assert.ok(!JSON.stringify(c).includes('at1') && !JSON.stringify(c).includes('rt1'), 'tokens never read back');
});

test('connected, it is a tool: the service\'s API only, its words framed, the token refreshed when due', async () => {
  const tools = require('../modules/harness/tools');
  const schema = tools.schemas().find(t => t.function.name === 'connector_stub');
  assert.ok(schema, 'the tool appears');
  assert.match(schema.function.description, /Call the Stub Hub API as al-on-stub/);
  assert.equal(require('../modules/harness/kits').kitOf('connector_stub'), 'connectors');
  const out = await tools.call('connector_stub', { path: '/issues', query: { state: 'open' } });
  assert.match(out, /GET \/api\/issues\?state=open → 200/);
  assert.match(out, /Printer offline/);
  assert.match(out, /^⟦/, 'framed as other people\'s words');
  assert.equal(seen.refreshes, 1, 'the token expiring within the minute was refreshed first');
  assert.equal(seen.auth.at(-1), 'Bearer at2', 'the refreshed token, not the expiring one');
  const outside = await tools.call('connector_stub', { path: 'https://evil.example/steal' });
  assert.match(outside, /token goes only to/);
  assert.ok(!seen.auth.includes(undefined));
});

test('a member\'s turn cannot use the owner\'s account until it is opened to everyone; disconnecting removes the tool', async () => {
  const tools = require('../modules/harness/tools');
  const member = { id: 'u_member', role: 'member' };
  assert.match(await tools.call('connector_stub', { path: '/issues' }, [], { user: member }), /for people who hold host/);
  await H.api(null, 'POST', '/api/connectors/stub', { who: 'everyone' });
  assert.match(await tools.call('connector_stub', { path: '/issues' }, [], { user: member }), /→ 200/);
  await H.api(null, 'DELETE', '/api/connectors/stub');
  assert.ok(!tools.schemas().some(t => t.function.name === 'connector_stub'));
  assert.equal((await H.api(null, 'GET', '/api/connectors')).body.connectors.find(x => x.id === 'stub').configured, true, 'the app stays for next time');
});
