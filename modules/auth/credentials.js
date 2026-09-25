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

/** Start a session; returns the cookie value (the only place the token exists in the clear). */
function startSession({ user, orgId, req }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const at = Date.now();
  authStore.createSession(sha256(token), {
    userId: user.id, orgId,
    expiresAt: new Date(at + SESSION_DAYS * 86400e3).toISOString(),
    stepUpAt: new Date(at).toISOString(),
    userAgent: String(req?.get?.('user-agent') || '').slice(0, 200),
    ip: req?.socket?.remoteAddress || null,
  });
  return token;
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
  if (!token) return null;
  const hash = sha256(token);
  const s = authStore.sessionByHash(hash);
  if (!s || Date.parse(s.expiresAt) < Date.now()) return null;
  const user = authStore.userById(s.userId);
  if (!user || user.suspendedAt) return null;
  const m = authStore.membership(s.orgId, user.id);
  if (!m || m.status !== 'active') return null;
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
  startSession, cookieHeader, tokenFrom, resolve, steppedUp,
};
