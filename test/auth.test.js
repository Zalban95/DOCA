'use strict';

/**
 * Authentication, phase 1 (docs/design/auth.md): a panel with no accounts is
 * set up by whoever can read its log; after that nothing answers without a
 * session, a role with the right, a recent sign-in for the machine itself, and
 * a request from the panel's own page.
 *
 * This file boots its own app rather than using H.start(), which signs an owner
 * in — the first half is about there being nobody.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const http   = require('node:http');

const H = require('./helpers');              // isolated DOCA_HOME and data
const { createApp } = require('../server');
const authStore   = require('../modules/auth/store');
const credentials = require('../modules/auth/credentials');
const authRoutes  = require('../modules/auth/routes');
const rights      = require('../modules/auth/rights');

let base;
const server = http.createServer(createApp());
test.before(() => new Promise(r => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });

/** A request as a browser on the panel's page would make it, with an optional cookie. */
async function call(method, p, { body, cookie, headers = {} } = {}) {
  const h = { 'Sec-Fetch-Site': 'same-origin', ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  for (const [k, v] of Object.entries(h)) if (v === '') delete h[k];
  const res = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: ct.includes('json') ? await res.json() : await res.text() };
}
const cookieOf = r => (r.headers.get('set-cookie') || '').split(';')[0];

let ownerCookie;

test('with no accounts, nothing answers but the login page and setup', async () => {
  assert.equal(authStore.userCount(), 0);
  assert.equal((await call('GET', '/api/status')).body.code, 'setup_required');
  const page = await call('GET', '/');
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /^\/login\?next=%2F$/);
  assert.equal((await call('GET', '/login.html')).status, 200, 'the login page itself is public');
  assert.equal((await call('GET', '/css/base.css')).status, 200, 'and its styles');
  const state = await call('GET', '/api/auth/state');
  assert.equal(state.body.needsSetup, true);
  assert.equal(state.body.codeNeeded, false, 'at the machine itself, no code');
  const remote = await call('GET', '/api/auth/state', { headers: { 'X-Forwarded-For': '100.102.108.110' } });
  assert.equal(remote.body.codeNeeded, true, 'from anywhere else, the code');
});

test('who counts as "at the machine": loopback, a loopback host, and nothing forwarded', () => {
  const at = (remoteAddress, host, headers = {}) => authRoutes.atTheMachine({ socket: { remoteAddress }, headers: { host, ...headers } });
  assert.equal(at('127.0.0.1', '127.0.0.1:4242'), true);
  assert.equal(at('::1', '[::1]:4242'), true);
  assert.equal(at('::ffff:127.0.0.1', 'localhost:4242'), true);
  assert.equal(at('100.102.108.110', '100.115.89.4:4242'), false, 'a tailnet device');
  assert.equal(at('127.0.0.1', 'al-office-desk.tail08f157.ts.net'), false, 'tailscale serve: loopback, but asked for the ts.net name');
  assert.equal(at('127.0.0.1', 'localhost:4242', { 'x-forwarded-for': '100.1.2.3' }), false, 'forwarded by a proxy');
  assert.equal(at('127.0.0.1', 'localhost:4242', { 'tailscale-user-login': 'x@y' }), false);
});

test('from elsewhere, setup needs the code from the log', async () => {
  const away = { 'X-Forwarded-For': '100.102.108.110' };
  const code = fs.readFileSync(authRoutes.SETUP_FILE, 'utf8');
  for (const tried of [undefined, 'nope']) {
    const r = await call('POST', '/api/auth/setup', { headers: away, body: { code: tried, email: 'a@b.c', password: 'long enough pw' } });
    assert.equal(r.body.code, 'bad_setup_code');
  }
  assert.equal(authStore.userCount(), 0);
  assert.ok(code.length >= 12);
});

test('at the machine, setup needs no code, and makes the owner of everything that exists', async () => {
  const device = H.mkDevice('Old phone', 'phone');                 // paired before accounts existed
  const code = fs.readFileSync(authRoutes.SETUP_FILE, 'utf8');

  const weak = await call('POST', '/api/auth/setup', { body: { email: 'owner@x.test', password: 'short' } });
  assert.equal(weak.body.code, 'weak_password');

  const ok = await call('POST', '/api/auth/setup', { body: { email: 'Owner@X.test', name: 'Owner', password: 'the owner password' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.role, 'owner');
  assert.equal(ok.body.user.email, 'owner@x.test', 'addresses are kept lower-case');
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, /doca_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Strict/);
  ownerCookie = cookieOf(ok);

  assert.equal(fs.existsSync(authRoutes.SETUP_FILE), false, 'the code is spent');
  assert.equal(require('../modules/api-v1/devices').get(device.device.id).userId, ok.body.user.id, 'existing devices are the owner\'s');
  assert.equal((await call('POST', '/api/auth/setup', { body: { code, email: 'x@y.z', password: 'another long pw' } })).status, 409);
  assert.match(authStore.auditTail(10).find(e => e.action === 'setup').detail, /at the machine/);

  const stored = authStore.userByEmail('owner@x.test');
  assert.match(stored.passwordHash, /^\$argon2id\$v=19\$m=65536,t=3,p=4\$/, 'StatENS\'s parameters and format');
  const sessions = JSON.stringify(require('../modules/store').readJson('auth/sessions', {}));
  assert.equal(sessions.includes(ownerCookie.split('=')[1]), false, 'only the hash of the token is stored');
});

test('signing in: wrong passwords are refused, then slowed down, and a right one gets a session', async () => {
  authRoutes._failures.clear();
  const bad = await call('POST', '/api/auth/login', { body: { email: 'owner@x.test', password: 'wrong' } });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, 'bad_credentials');
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'nobody@x.test', password: 'x' } })).body.error,
    bad.body.error, 'an unknown address gets the same answer');
  for (let i = 0; i < 6; i++) await call('POST', '/api/auth/login', { body: { email: 'owner@x.test', password: 'wrong' } });
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'owner@x.test', password: 'the owner password' } })).status, 429,
    'even the right password waits once the account is being guessed at');
  authRoutes._failures.clear();

  const ok = await call('POST', '/api/auth/login', { body: { email: 'OWNER@x.test', password: 'the owner password' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/api/auth/me', { cookie: cookieOf(ok) })).body.role, 'owner');
  assert.ok(authStore.auditTail(50).some(e => e.action === 'login failed'));
});

test('a role only reaches what its rights allow, and an unknown route is refused', async () => {
  const member = await H.signIn('member');
  const viewer = await H.signIn('viewer');
  assert.equal((await call('GET', '/api/status', { cookie: viewer.cookie })).status, 200, 'a viewer can look');
  assert.equal((await call('POST', '/api/harness/sessions', { cookie: viewer.cookie, body: {} })).status, 403, 'but not talk');
  assert.equal((await call('GET', '/api/files/list?path=/tmp', { cookie: member.cookie })).body.code, 'forbidden', 'a member cannot read files');
  assert.equal((await call('GET', '/api/backups', { cookie: member.cookie })).status, 403);
  assert.notEqual((await call('GET', '/api/files/list?path=/tmp', { cookie: ownerCookie })).status, 403, 'the owner can');

  const unknown = await call('GET', '/api/not-a-route-anyone-mapped', { cookie: ownerCookie });
  assert.equal(unknown.body.code, 'no_rule', 'fails closed');
});

test('the machine itself needs a recent sign-in', async () => {
  const hash = credentials.sha256(ownerCookie.split('=')[1]);
  authStore.updateSession(hash, { stepUpAt: new Date(Date.now() - 13 * 3600e3).toISOString() });
  assert.equal((await call('GET', '/api/files/list?path=/tmp', { cookie: ownerCookie })).body.code, 'step_up_required');
  assert.equal((await call('GET', '/api/status', { cookie: ownerCookie })).status, 200, 'looking does not');
  assert.equal((await call('POST', '/api/auth/step-up', { cookie: ownerCookie, body: { password: 'wrong' } })).status, 403);
  assert.equal((await call('POST', '/api/auth/step-up', { cookie: ownerCookie, body: { password: 'the owner password' } })).status, 200);
  assert.notEqual((await call('GET', '/api/files/list?path=/tmp', { cookie: ownerCookie })).status, 401);
});

test('a change must come from the panel\'s own page', async () => {
  const bare = await call('POST', '/api/harness/sessions', { cookie: ownerCookie, body: {}, headers: { 'Sec-Fetch-Site': '' } });
  assert.equal(bare.body.code, 'browser_only', 'a cookie alone, as curl or another site would send it');
  const other = await call('POST', '/api/harness/sessions', { cookie: ownerCookie, body: {}, headers: { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.test' } });
  assert.equal(other.body.code, 'browser_only');
  const own = await call('POST', '/api/harness/sessions', { cookie: ownerCookie, body: {}, headers: { 'Sec-Fetch-Site': '', Origin: base } });
  assert.notEqual(own.body.code, 'browser_only', 'its own origin passes');
  assert.ok(authStore.auditTail(20).some(e => e.action === 'POST /api/harness/sessions'), 'and the change is audited');
});

test('a new password signs out every other session; a suspended person and their devices are out', async () => {
  const other = await call('POST', '/api/auth/login', { body: { email: 'owner@x.test', password: 'the owner password' } });
  const otherCookie = cookieOf(other);
  const r = await call('POST', '/api/auth/password', { cookie: ownerCookie, body: { current: 'the owner password', password: 'a brand new password' } });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/auth/me', { cookie: otherCookie })).status, 401, 'the other session ended');
  assert.equal((await call('GET', '/api/auth/me', { cookie: ownerCookie })).status, 200, 'this one did not');

  const member = await H.signIn('member');
  const phone = H.mkDevice('Member phone', 'phone');
  require('../modules/api-v1/devices').update(phone.device.id, { userId: member.user.id });
  const caps = () => fetch(`${base}/api/v1/capabilities`, { headers: { Authorization: `Bearer ${phone.token}` } }).then(x => x.status);
  assert.equal(await caps(), 200);
  authStore.updateUser(member.user.id, { suspendedAt: new Date().toISOString() });
  assert.equal((await call('GET', '/api/auth/me', { cookie: member.cookie })).status, 401);
  assert.equal(await caps(), 401, 'their device is silenced with them');
});

test('an account made for someone must get a new password before anything else', async () => {
  const temp = await H.signIn('member');
  authStore.updateUser(temp.user.id, { mustChangePassword: true });
  assert.equal((await call('GET', '/api/status', { cookie: temp.cookie })).body.code, 'password_change_required');
  assert.equal((await call('GET', '/api/auth/me', { cookie: temp.cookie })).status, 200);
  assert.equal((await call('POST', '/api/auth/password', { cookie: temp.cookie, body: { current: temp.password, password: 'my own password now' } })).status, 200);
  assert.equal((await call('GET', '/api/status', { cookie: temp.cookie })).status, 200);
});

test('signing out ends the session and clears the cookie', async () => {
  const s = await call('POST', '/api/auth/login', { body: { email: 'owner@x.test', password: 'a brand new password' } });
  const c = cookieOf(s);
  const out = await call('POST', '/api/auth/logout', { cookie: c });
  assert.match(out.headers.get('set-cookie'), /doca_session=; .*Max-Age=0/);
  assert.equal((await call('GET', '/api/auth/me', { cookie: c })).status, 401);
});

test('a paired app opening the panel with its device token gets a session, capped by the device\'s scopes', async () => {
  const devices = require('../modules/api-v1/devices');
  const owner = authStore.userByEmail('owner@x.test');
  const phone = H.mkDevice('Pixel', 'phone');
  devices.update(phone.device.id, { userId: owner.id, orgId: authStore.defaultOrg().id });
  const bearer = { Authorization: `Bearer ${phone.token}` };

  // What DocaMobile does: loadUrl(dashboard, { Authorization: Bearer … }).
  const page = await call('GET', '/', { headers: bearer });
  assert.equal(page.status, 200, 'the panel, not the login page');
  const c = cookieOf(page);
  assert.match(c, /^doca_session=/);
  assert.equal((await call('GET', '/api/status', { cookie: c })).status, 200, 'the cookie carries the rest');
  assert.notEqual((await call('POST', '/api/harness/sessions', { cookie: c, body: {} })).status, 401, 'a phone may chat');

  const files = await call('GET', '/api/files/list?path=/tmp', { cookie: c });
  assert.equal(files.body.code, 'step_up_required', 'the machine itself needs the person, not the phone');
  assert.match(files.body.error, /This device can look and chat/);
  const up = await call('POST', '/api/auth/step-up', { cookie: c, body: { password: 'a brand new password' } });
  assert.equal(up.status, 200);
  assert.notEqual((await call('GET', '/api/files/list?path=/tmp', { cookie: c })).status, 401, 'the password lifts the cap to the owner\'s role');
  assert.ok(authStore.auditTail(20).some(e => e.action === 'device sign-in' && e.via === phone.device.id));

  devices.revoke(phone.device.id);
  assert.equal((await call('GET', '/api/auth/me', { cookie: c })).status, 401, 'the session ends with the device');
});

test('a device token opens nothing for a device nobody owns, or on an API call', async () => {
  const stray = H.mkDevice('Unclaimed', 'phone');
  const page = await call('GET', '/', { headers: { Authorization: `Bearer ${stray.token}` } });
  assert.equal(page.status, 302, 'no owner, no session: the login page');
  const devices = require('../modules/api-v1/devices');
  devices.update(stray.device.id, { userId: authStore.userByEmail('owner@x.test').id });
  const api = await call('GET', '/api/status', { headers: { Authorization: `Bearer ${stray.token}` } });
  assert.equal(api.body.code, 'unauthenticated', 'only a page load is turned into a session');
  assert.equal(api.headers.get('set-cookie'), null);
});

test('every route the app has is in the rights table — nothing is reachable by omission', () => {
  const app = createApp();
  const routes = [];
  for (const layer of app._router.stack) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) routes.push([m.toUpperCase(), layer.route.path]);
  }
  assert.ok(routes.length > 150, 'the walk found the routes');
  const unmapped = routes.filter(([m, p]) => typeof p === 'string' && p.startsWith('/api/')
    && rights.rightFor(m, p.replace(/:[^/]+/g, 'x')) === null).map(r => r.join(' '));
  assert.deepEqual(unmapped, [], 'add a row to modules/auth/rights.js');
});
