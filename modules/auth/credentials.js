'use strict';

/**
 * Passwords and sessions — StatENS's rules, in Node.
 *
 * Passwords: Argon2id (hash-wasm, WebAssembly), t=3, m=64 MiB, p=4, 16-byte
 * salt, 32-byte key, stored as the PHC string so the cost can rise later
 * without invalidating anyone. The string is byte-compatible with StatENS's Go
 * `HashPassword`, so an account can move between the two.
 *
 * Sessions: 32 random bytes in an HttpOnly, SameSite=Strict cookie; only the
 * SHA-256 is stored, so a leaked data directory cannot be replayed as a login.
 * Not JWTs: suspending someone has to sign them out now.
 */
const crypto = require('crypto');
const { argon2id, argon2Verify } = require('hash-wasm');
const authStore = require('./store');

const ARGON = { parallelism: 4, iterations: 3, memorySize: 64 * 1024, hashLength: 32 };
const MIN_PASSWORD = 10;

const SESSION_DAYS = 30;
const STEP_UP_HOURS = 12;
const COOKIE = 'doca_session';

async function hashPassword(password) {
  return argon2id({ password: String(password), salt: crypto.randomBytes(16), ...ARGON, outputType: 'encoded' });
}

async function verifyPassword(password, encoded) {
  if (!encoded) return false;
  try { return await argon2Verify({ password: String(password), hash: encoded }); }
  catch { return false; }
}

function checkNewPassword(p) {
  if (String(p || '').length < MIN_PASSWORD)
    throw Object.assign(new Error(`Use at least ${MIN_PASSWORD} characters.`), { status: 400, code: 'weak_password' });
}

/**
 * A password for an account someone else is creating: shown once, replaced at
 * first sign-in. From an alphabet that survives being read off a screen — no O
 * or 0, no l, I or 1.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function oneTimePassword(length = 14) {
  let out = '';
  while (out.length < length) {
    const b = crypto.randomBytes(1)[0];
    if (b < 256 - (256 % ALPHABET.length)) out += ALPHABET[b % ALPHABET.length];   // no modulo bias
  }
  return out;
}

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

/**
 * Start a session; returns the cookie value (the only place the token exists in
 * the clear). A session opened from a device token carries `deviceId` and a
 * `cap` — the rights that device's scopes allow — and no recent sign-in, so
 * anything beyond the cap asks for the password first (see fromDevice).
 */
function startSession({ user, orgId, req, deviceId = null, cap = null }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const at = Date.now();
  authStore.createSession(sha256(token), {
    userId: user.id, orgId, deviceId, cap,
    expiresAt: new Date(at + SESSION_DAYS * 86400e3).toISOString(),
    stepUpAt: deviceId ? null : new Date(at).toISOString(),
    userAgent: String(req?.get?.('user-agent') || '').slice(0, 200),
    ip: req?.socket?.remoteAddress || null,
  });
  return token;
}

/**
 * What a device's scopes allow on the dashboard: all of its person's role for
 * an admin token (`*`), else looking, the harness chat, and device management —
 * never the machine itself without the person's password.
 */
function capOf(scopes) {
  const { hasScope } = require('../api-v1/scopes');
  if (hasScope(scopes, '*')) return null;
  const cap = [];
  if (scopes.some(s => s === 'read' || s.startsWith('read:'))) cap.push('read');
  if (hasScope(scopes, 'harness:chat') || hasScope(scopes, 'harness:sessions')) cap.push('chat');
  if (hasScope(scopes, 'devices:admin')) cap.push('devices');
  return cap;
}

/**
 * A page opened by a paired app with its device token: the app's WebView sends
 * `Authorization: Bearer` on the page load (DocaMobile does), and nothing after
 * it — so the token opens a session for the device's person, capped by the
 * device's scopes, and the cookie carries the rest. A browser cannot send that
 * header on a navigation from another site, so this is not a way in from one.
 * @returns {{ who: object, token: string }|null}
 */
function fromDevice(req) {
  const h = String(req.headers.authorization || '');
  if (!/^Bearer\s+/i.test(h)) return null;
  const device = require('../api-v1/devices').authenticate(h.replace(/^Bearer\s+/i, '').trim());
  if (!device?.userId) return null;
  const user = authStore.userById(device.userId);
  if (!user || user.suspendedAt) return null;
  const orgId = device.orgId || authStore.defaultOrg()?.id;
  const m = authStore.membership(orgId, user.id);
  if (!m || m.status !== 'active') return null;
  const cap = capOf(device.scopes || []);
  if (cap && !cap.includes('read')) return null;
  const token = startSession({ user, orgId, req, deviceId: device.id, cap });
  authStore.audit({ orgId, actorId: user.id, via: device.id, action: 'device sign-in', detail: device.name });
  return { token, who: resolveHash(sha256(token)) };
}

function cookieHeader(token, { secure, clear = false } = {}) {
  const parts = [`${COOKIE}=${clear ? '' : token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (secure) parts.push('Secure');
  parts.push(clear ? 'Max-Age=0' : `Max-Age=${SESSION_DAYS * 86400}`);
  return parts.join('; ');
}

function tokenFrom(req) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=') || null;
  }
  return null;
}

let _lastTouch = 0;

/**
 * The signed-in person behind a request, or null: a live session, a user who
 * is not suspended, and an approved membership.
 */
function resolve(req) {
  const token = tokenFrom(req);
  return token ? resolveHash(sha256(token)) : null;
}

function resolveHash(hash) {
  const s = authStore.sessionByHash(hash);
  if (!s || Date.parse(s.expiresAt) < Date.now()) return null;
  const user = authStore.userById(s.userId);
  if (!user || user.suspendedAt) return null;
  const m = authStore.membership(s.orgId, user.id);
  if (!m || m.status !== 'active') return null;
  // A device's session ends with the device.
  if (s.deviceId) {
    const d = require('../api-v1/devices').get(s.deviceId);
    if (!d || d.revokedAt) return null;
  }
  // lastSeenAt is best effort; writing it on every request would rewrite the file on every request.
  if (Date.now() - _lastTouch > 60e3) { _lastTouch = Date.now(); authStore.updateSession(hash, { lastSeenAt: new Date().toISOString() }); }
  return { user, orgId: s.orgId, role: m.role, session: { hash, ...s } };
}

function steppedUp(session) {
  return !!session?.stepUpAt && Date.now() - Date.parse(session.stepUpAt) < STEP_UP_HOURS * 3600e3;
}

module.exports = {
  COOKIE, SESSION_DAYS, STEP_UP_HOURS, MIN_PASSWORD,
  hashPassword, verifyPassword, checkNewPassword, oneTimePassword, sha256,
  startSession, fromDevice, capOf, cookieHeader, tokenFrom, resolve, steppedUp,
};
