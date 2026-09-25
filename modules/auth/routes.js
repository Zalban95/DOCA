'use strict';

/**
 * /api/auth — setting up the owner, signing in and out, the account itself.
 *
 * Setup exists only while there are no users, and needs a one-time code that is
 * printed in the server log and kept in `<DOCA_HOME>/.setup-code` (`./run.sh
 * setup-code` prints it): being on the tailnet is not enough to claim the panel,
 * being able to read its log is.
 */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const authStore   = require('./store');
const credentials = require('./credentials');
const { HOME_DIR } = require('../paths');

const SETUP_FILE = path.join(HOME_DIR, '.setup-code');

/* ── Setup code ────────────────────────────────────────── */

let _announced = false;

/** The setup code, made (and printed once) the first time it is needed. */
function setupCode() {
  let code = null;
  try { code = fs.readFileSync(SETUP_FILE, 'utf8').trim(); } catch {}
  if (!code) {
    code = credentials.oneTimePassword(12);
    fs.writeFileSync(SETUP_FILE, code, { mode: 0o600 });
  }
  if (!_announced) {
    _announced = true;
    console.log(`[auth] No account exists yet. Setup code: ${code}  (also: ./run.sh setup-code)`);
  }
  return code;
}

/**
 * A browser on this machine, not one that reached it through something.
 *
 * Setting up the owner needs the logged code from anywhere else — another
 * device on the tailnet must not be able to claim the panel first — but not
 * from the machine itself: whoever can open `localhost` there is at the desk,
 * or is a program already running as this user, and before the owner exists
 * nothing can start an agent turn (every harness route needs a session).
 *
 * All three must hold, because `tailscale serve` proxies from 127.0.0.1: the
 * connection comes from loopback, the browser asked for a loopback host (a
 * proxied request asks for the ts.net name), and nothing says it was forwarded.
 */
function atTheMachine(req) {
  const plain = a => String(a || '').replace(/^::ffff:/, '');
  const from = plain(req.socket?.remoteAddress);
  if (!(from === '::1' || /^127\./.test(from))) return false;
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) return false;
  return !['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'tailscale-user-login'].some(h => req.headers[h]);
}

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/* ── Rate limit: by account and by address ─────────────── */

const failures = new Map();   // key -> { n, until }

function limited(keys) {
  const t = Date.now();
  for (const k of keys) { const f = failures.get(k); if (f && f.until > t) return Math.ceil((f.until - t) / 1000); }
  return 0;
}
function failed(keys) {
  // Old entries go when the table grows: an address that stopped trying is no
  // reason to hold memory forever.
  if (failures.size > 1000) { const t = Date.now(); for (const [k, f] of failures) if (f.until < t - 3600e3) failures.delete(k); }
  for (const k of keys) {
    const f = failures.get(k) || { n: 0, until: 0 };
    f.n++;
    // Free for five, then a growing wait; locked for 15 minutes from the tenth.
    f.until = Date.now() + (f.n >= 10 ? 15 * 60e3 : f.n > 5 ? 2 ** (f.n - 5) * 1000 : 0);
    failures.set(k, f);
  }
}
const succeeded = keys => keys.forEach(k => failures.delete(k));

/* ── Handlers ──────────────────────────────────────────── */

const fail = (res, e) => res.status(e.status || 500).json({ error: e.message, code: e.code });
const secure = req => req.secure || req.socket?.encrypted === true;

function me(auth) {
  const { user, role, orgId } = auth;
  return { id: user.id, email: user.email, name: user.name, role, orgId, mustChangePassword: !!user.mustChangePassword };
}

/** GET — what the login page should show. */
function handleState(req, res) {
  const needsSetup = authStore.userCount() === 0;
  const codeNeeded = needsSetup && !atTheMachine(req);
  if (codeNeeded) setupCode();
  const who = needsSetup ? null : credentials.resolve(req);
  res.json({ needsSetup, codeNeeded, signedIn: !!who, user: who ? me(who) : null, secure: secure(req) });
}

/** POST { code, email, name, password } — the first account, which owns everything that exists. */
async function handleSetup(req, res) {
  try {
    if (authStore.userCount() > 0) throw Object.assign(new Error('The owner is already set up. Sign in instead.'), { status: 409 });
    const { code, email, name, password } = req.body || {};
    const local = atTheMachine(req);
    if (!local && !same(String(code || '').trim(), setupCode()))
      throw Object.assign(new Error('That setup code is not right. It is in the server log, or run ./run.sh setup-code on the host.'), { status: 403, code: 'bad_setup_code' });
    credentials.checkNewPassword(password);
    const org = authStore.defaultOrg() || authStore.createOrg(require('../branding').name('product'));
    const user = authStore.createUser({ email, name, passwordHash: await credentials.hashPassword(password) });
    authStore.addMembership({ orgId: org.id, userId: user.id, role: 'owner', status: 'active' });
    const moved = claimDevices(org.id, user.id);
    fs.rmSync(SETUP_FILE, { force: true });
    authStore.audit({ orgId: org.id, actorId: user.id, action: 'setup',
      detail: `owner created ${local ? 'at the machine' : 'with the setup code'}; ${moved} existing devices now theirs` });
    const token = credentials.startSession({ user, orgId: org.id, req });
    res.setHeader('Set-Cookie', credentials.cookieHeader(token, { secure: secure(req) }));
    res.json({ ok: true, user: me({ user, role: 'owner', orgId: org.id }) });
  } catch (e) { fail(res, e); }
}

/** Everything that existed before accounts becomes the first user's. */
function claimDevices(orgId, userId) {
  const devices = require('../api-v1/devices');
  let n = 0;
  for (const d of devices.list()) if (!d.userId) { devices.update(d.id, { userId, orgId }); n++; }
  return n;
}

/** POST { email, password } */
async function handleLogin(req, res) {
  const { email, password } = req.body || {};
  const keys = [`e:${String(email || '').toLowerCase()}`, `a:${req.socket?.remoteAddress}`];
  const wait = limited(keys);
  if (wait) return fail(res, Object.assign(new Error(`Too many attempts. Try again in ${wait} s.`), { status: 429, code: 'rate_limited' }));

  const user = authStore.userByEmail(email);
  // Verify even for an unknown address, so the answer takes the same time either way.
  const ok = await credentials.verifyPassword(password, user?.passwordHash || '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  const org = authStore.defaultOrg();
  const m = user && org ? authStore.membership(org.id, user.id) : null;
  if (!user || !ok || user.suspendedAt || !m || m.status !== 'active') {
    failed(keys);
    authStore.audit({ orgId: org?.id, actorId: user?.id || null, action: 'login failed', detail: String(email || '').slice(0, 100), ip: req.socket?.remoteAddress });
    const why = user && ok && m?.status === 'pending' ? 'Your account is waiting for an administrator to approve it.' : 'Wrong email or password.';
    return fail(res, Object.assign(new Error(why), { status: 401, code: 'bad_credentials' }));
  }
  succeeded(keys);
  authStore.pruneSessions();   // expired sessions go whenever someone signs in
  const token = credentials.startSession({ user, orgId: org.id, req });
  authStore.audit({ orgId: org.id, actorId: user.id, action: 'login', ip: req.socket?.remoteAddress });
  res.setHeader('Set-Cookie', credentials.cookieHeader(token, { secure: secure(req) }));
  res.json({ ok: true, user: me({ user, role: m.role, orgId: org.id }) });
}

function handleLogout(req, res) {
  if (req.auth) {
    authStore.deleteSession(req.auth.session.hash);
    authStore.audit({ orgId: req.auth.orgId, actorId: req.auth.user.id, action: 'logout' });
  }
  res.setHeader('Set-Cookie', credentials.cookieHeader('', { secure: secure(req), clear: true }));
  res.json({ ok: true });
}

function handleMe(req, res) { res.json(me(req.auth)); }

/** POST { current, password } — and every other session of this user ends. */
async function handlePassword(req, res) {
  try {
    const { current, password } = req.body || {};
    const { user } = req.auth;
    if (!await credentials.verifyPassword(current, user.passwordHash))
      throw Object.assign(new Error('Your current password is not right.'), { status: 403, code: 'bad_credentials' });
    credentials.checkNewPassword(password);
    authStore.updateUser(user.id, { passwordHash: await credentials.hashPassword(password), mustChangePassword: false });
    authStore.deleteSessionsOf(user.id, req.auth.session.hash);
    authStore.updateSession(req.auth.session.hash, { stepUpAt: new Date().toISOString() });
    authStore.audit({ orgId: req.auth.orgId, actorId: user.id, action: 'password changed' });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
}

/** POST { password } — renew the recent sign-in that host, users and org actions need. */
async function handleStepUp(req, res) {
  const keys = [`e:${req.auth.user.email}`];
  const wait = limited(keys);
  if (wait) return fail(res, Object.assign(new Error(`Too many attempts. Try again in ${wait} s.`), { status: 429, code: 'rate_limited' }));
  if (!await credentials.verifyPassword(req.body?.password, req.auth.user.passwordHash)) {
    failed(keys);
    return fail(res, Object.assign(new Error('That password is not right.'), { status: 403, code: 'bad_credentials' }));
  }
  succeeded(keys);
  // The password is the person: it renews the recent sign-in, and lifts a
  // device session's cap to the person's own role.
  authStore.updateSession(req.auth.session.hash, { stepUpAt: new Date().toISOString(), cap: null });
  res.json({ ok: true });
}

/** GET — this user's sessions; DELETE — sign out everywhere else. */
function handleSessions(req, res) {
  if (req.method === 'DELETE') {
    authStore.deleteSessionsOf(req.auth.user.id, req.auth.session.hash);
    authStore.audit({ orgId: req.auth.orgId, actorId: req.auth.user.id, action: 'signed out everywhere else' });
    return res.json({ ok: true });
  }
  authStore.pruneSessions();
  res.json({ current: req.auth.session.hash.slice(0, 8) });
}

function mount(app) {
  app.get ('/login', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'login.html')));
  app.get ('/api/auth/state',    handleState);
  app.post('/api/auth/setup',    handleSetup);
  app.post('/api/auth/login',    handleLogin);
  app.post('/api/auth/logout',   handleLogout);
  app.get ('/api/auth/me',       handleMe);
  // Nothing to it: the gate has already checked the host right and a recent
  // sign-in, which a WebSocket cannot ask for itself. See public/js/lib/api.js.
  app.get ('/api/auth/host-check', (_req, res) => res.json({ ok: true }));
  app.post('/api/auth/password', handlePassword);
  app.post('/api/auth/step-up',  handleStepUp);
  app.get   ('/api/auth/sessions', handleSessions);
  app.delete('/api/auth/sessions', handleSessions);
}

module.exports = { mount, atTheMachine, setupCode, SETUP_FILE, _failures: failures };
