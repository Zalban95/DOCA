'use strict';

/**
 * The Matrix client-server API, as much of it as the channel uses (spec v1.11): whoami, sync, join, send, typing,
 * media upload and download. No dependency — Node's fetch. The homeserver and the bot account's access token are a
 * host's (prefs `channels.matrix.homeserver` / `.accessToken`, or MATRIX_HOMESERVER / MATRIX_ACCESS_TOKEN); the
 * token is sent as a header, never in a URL, and never appears in an error or a log line.
 */
const crypto = require('crypto');

const prefs = () => require('../../utils').loadPrefs().channels?.matrix || {};
const base = () => String(process.env.MATRIX_HOMESERVER || prefs().homeserver || '').replace(/\/+$/, '');
const token = () => String(process.env.MATRIX_ACCESS_TOKEN || prefs().accessToken || '');

const fail = (what, why, extra = {}) => Object.assign(new Error(`Matrix ${what}: ${why}`), { status: 502, ...extra });
const signalFor = (signal, ms) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));
const enc = encodeURIComponent;

async function req(method, path, { body, query, signal, timeoutMs = 30000, raw = false, headers = {} } = {}) {
  if (!base()) throw fail(path, 'no homeserver (Settings → Channels)', { status: 409 });
  if (!token()) throw fail(path, 'no access token (Settings → Channels)', { status: 409 });
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null))}` : '';
  let r;
  try {
    r = await fetch(`${base()}${path}${qs}`, { method, signal: signalFor(signal, timeoutMs),
      headers: { Authorization: `Bearer ${token()}`, ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  } catch (e) { throw fail(path.split('?')[0], e.name === 'AbortError' || e.name === 'TimeoutError' ? 'no answer in time' : 'cannot reach the homeserver', { aborted: !!signal?.aborted }); }
  if (raw && r.ok) return r;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(path.split('?')[0].replace(/\/rooms\/[^/]+/, '/rooms/…'), j.error || `HTTP ${r.status}`, { code: j.errcode, retryAfter: j.retry_after_ms ? j.retry_after_ms / 1000 : undefined, httpStatus: r.status });
  return j;
}

const C = '/_matrix/client/v3';
const whoami = () => req('GET', `${C}/account/whoami`);
const sync = ({ since, timeoutMs, filter }, signal) =>
  req('GET', `${C}/sync`, { query: { since, timeout: timeoutMs, filter: filter && JSON.stringify(filter) }, signal, timeoutMs: timeoutMs + 15000 });
const join = roomId => req('POST', `${C}/join/${enc(roomId)}`, { body: {} });
const leave = roomId => req('POST', `${C}/rooms/${enc(roomId)}/leave`, { body: {} });
const members = roomId => req('GET', `${C}/rooms/${enc(roomId)}/joined_members`);
const send = (roomId, content) => req('PUT', `${C}/rooms/${enc(roomId)}/send/m.room.message/${crypto.randomUUID()}`, { body: content });
const typing = (roomId, userId, on = true) => req('PUT', `${C}/rooms/${enc(roomId)}/typing/${enc(userId)}`, { body: { typing: on, timeout: 30000 } });

/** Bytes up to the media repository; returns the mxc:// address. */
async function upload(buffer, name, mime) {
  const j = await req('POST', '/_matrix/media/v3/upload', { body: buffer, query: { filename: name }, headers: { 'Content-Type': mime || 'application/octet-stream' }, timeoutMs: 120000 });
  return j.content_uri;
}

/** An mxc:// file someone sent: authenticated media first (v1.11), the older route for an older server. */
async function download(mxc) {
  const m = /^mxc:\/\/([^/]+)\/([^/?#]+)/.exec(String(mxc || ''));
  if (!m) throw fail('download', 'not an mxc address');
  let r;
  try { r = await req('GET', `/_matrix/client/v1/media/download/${enc(m[1])}/${enc(m[2])}`, { raw: true, timeoutMs: 120000 }); }
  catch (e) { if (![404, 400].includes(e.httpStatus)) throw e; r = await req('GET', `/_matrix/media/v3/download/${enc(m[1])}/${enc(m[2])}`, { raw: true, timeoutMs: 120000 }); }
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { whoami, sync, join, leave, members, send, typing, upload, download, token, base, prefs };
