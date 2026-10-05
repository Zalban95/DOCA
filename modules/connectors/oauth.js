'use strict';

/**
 * OAuth 2.0 for connectors (TODO H9.3): the authorization-code flow with PKCE (S256), the owner's own app, the
 * hub's own callback — `<the panel's address>/api/connectors/callback`, which is what the owner registers in the
 * service's console. `start()` makes the address to send the person to (with a one-time state, ten minutes);
 * `finish()` takes the code back, exchanges it for tokens and keeps them in the vault; `token()` hands a caller a
 * live access token, refreshing it first when it is about to expire and a refresh token exists.
 */
const crypto = require('crypto');
const vault = require('./vault');
const { CATALOG } = require('./catalog');

const pending = new Map();   // state → { id, verifier, redirectUri, at }
const TTL = 10 * 60 * 1000;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A connector's addresses and scopes: the catalogue's, or what the owner typed for a custom one. */
function spec(id) {
  const rec = vault.get(id) || {};
  const base = CATALOG[rec.kind || id] || null;
  if (!base) throw bad(`No connector "${id}".`, 404);
  const urls = base.custom ? rec.urls || {} : base;
  return { id, label: rec.label || base.label, authorize: urls.authorize, token: urls.token, api: [].concat(urls.api || []),
    whoami: urls.whoami || null, account: base.account || (j => j.login || j.email || j.name || j.id), scopes: rec.scopes ?? base.scopes, extra: base.extra || {} };
}

function start(id, redirectUri) {
  const s = spec(id), rec = vault.get(id);
  if (!rec?.clientId) throw bad(`${s.label} has no OAuth app yet: give its client id (and secret) first.`, 409);
  if (!s.authorize || !s.token) throw bad(`${s.label} has no authorize or token address.`, 409);
  for (const [k, v] of pending) if (Date.now() - v.at > TTL) pending.delete(k);
  const state = b64url(crypto.randomBytes(18)), verifier = b64url(crypto.randomBytes(32));
  pending.set(state, { id, verifier, redirectUri, at: Date.now() });
  const q = new URLSearchParams({ response_type: 'code', client_id: rec.clientId, redirect_uri: redirectUri, state,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    ...(s.scopes ? { scope: s.scopes } : {}), ...s.extra });
  return { url: `${s.authorize}${s.authorize.includes('?') ? '&' : '?'}${q}`, state };
}

async function exchange(s, rec, params) {
  const r = await fetch(s.token, { method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: rec.clientId, ...(rec.clientSecret ? { client_secret: rec.clientSecret } : {}), ...params }) })
    .catch(e => { throw bad(`${s.label}: cannot reach ${s.token} (${e.message})`, 502); });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw bad(`${s.label} refused: ${j.error_description || j.error || `HTTP ${r.status}`}`, 502);
  return { accessToken: j.access_token, ...(j.refresh_token ? { refreshToken: j.refresh_token } : {}),
    expiresAt: j.expires_in ? new Date(Date.now() + Number(j.expires_in) * 1000).toISOString() : null, ...(j.scope ? { scopes: j.scope } : {}) };
}

/** The code is back: tokens into the vault, and whose account they are. */
async function finish(state, code) {
  const p = pending.get(String(state || ''));
  pending.delete(String(state || ''));
  if (!p || Date.now() - p.at > TTL) throw bad('This sign-in link is unknown or has expired: start it again from Settings → Connectors.');
  if (!code) throw bad('The service sent no code back (was access refused?).');
  const s = spec(p.id), rec = vault.get(p.id);
  const tokens = await exchange(s, rec, { grant_type: 'authorization_code', code, redirect_uri: p.redirectUri, code_verifier: p.verifier });
  let account = null;
  if (s.whoami) {
    try {
      const url = /^https?:/.test(s.whoami) ? s.whoami : `${s.api[0]}${s.whoami}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json', 'User-Agent': 'DOCA' }, signal: AbortSignal.timeout(15000) });
      if (r.ok) account = String(s.account(await r.json()) || '') || null;
    } catch { /* the connection works without a name */ }
  }
  vault.patch(p.id, { ...tokens, account, connectedAt: new Date().toISOString() });
  return { id: p.id, label: s.label, account };
}

/** A live access token for a call, refreshed when it expires within a minute. */
async function token(id) {
  const rec = vault.get(id);
  if (!rec?.accessToken) throw bad(`${spec(id).label} is not connected.`, 409);
  if (rec.expiresAt && Date.parse(rec.expiresAt) - Date.now() < 60000) {
    if (!rec.refreshToken) throw bad(`${spec(id).label}'s sign-in expired and gave no refresh token: connect it again in Settings → Connectors.`, 401);
    const fresh = await exchange(spec(id), rec, { grant_type: 'refresh_token', refresh_token: rec.refreshToken });
    vault.patch(id, fresh);
    return fresh.accessToken;
  }
  return rec.accessToken;
}

module.exports = { spec, start, finish, token };
