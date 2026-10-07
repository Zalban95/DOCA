'use strict';

/**
 * Keys for services (asked 2026-10-06: "if I asked the chat to set up … and I just have to paste the API"). An API
 * that takes a key — a 3D generator, a home server, any REST service — is set up by pasting its key once, tied to the
 * service's own address: the agent calls it with `api_call {url, key: "<name>"}` and the hub adds the key to that
 * request only when the address is the key's own origin (a look-alike gets nothing), as a header (`Authorization:
 * Bearer …` by default, or any header and prefix), a query parameter, or — for a service that trades an id and a secret
 * for a short-lived token (hi3d.ai, many "client credentials" APIs) — `exchange`: the hub posts the id and secret to the
 * service's token address itself (HTTP Basic), keeps the token it gets back until it expires or is refused, and sends that. The agent never sees the key: it is not in the
 * prompt, the transcript or the result, which is scrubbed of it in case a service echoes it back. Used on a turn of
 * someone holding host unless the admin opens a key to everyone (`who`), like a connector. Kept in
 * DATA_DIR/keys/services.json (0600, PROTECTED_FILES); Field → Connectors → Keys for services.
 */
const fs = require('fs');
const path = require('path');

const file = () => require('./paths').SERVICE_KEYS_FILE;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const all = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };
function write(d) { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(d, null, 2), { mode: 0o600 }); try { fs.chmodSync(file(), 0o600); } catch { /* Windows */ } }

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
// field: a header's or a parameter's name, or for an exchange the token address
const view = k => ({ name: k.name, origin: k.origin, place: k.place, field: k.field, prefix: k.prefix, who: k.who, note: k.note || '', hasKey: !!k.key, savedAt: k.savedAt });
const list = () => Object.values(all()).map(view);

function save({ name, origin, place = 'header', field, prefix, who = 'host', note = '', key }) {
  name = String(name || '').trim().toLowerCase();
  if (!NAME.test(name)) throw bad('A key\'s name is short, lowercase letters, digits and dashes: hyper3d, home-assistant.');
  let o;
  try { o = new URL(String(origin || '')).origin; } catch { throw bad('The address is the service\'s, like https://api.example.com.'); }
  if (!/^https?:/.test(o)) throw bad('The address is an http(s) one.');
  if (!['header', 'query', 'exchange'].includes(place)) throw bad('A key goes in a header, in the query, or is exchanged for a token.');
  let tokenUrl = null;
  if (place === 'exchange') {
    try { tokenUrl = new URL(String(field || '')).toString(); } catch { throw bad('For an exchange, give the token address, like https://api.example.com/oauth/token.'); }
    if (new URL(tokenUrl).origin !== o) throw bad('The token address is on the service\'s own address.');
  }
  const d = all();
  const MASK = require('./secrets-mask').MASK;
  const given = typeof key === 'string' && key.trim() && key !== MASK ? key.trim() : d[name]?.key || '';
  if (!given) throw bad('Paste the key itself.');
  if (place === 'exchange' && !/^[^:]+:.+$/.test(given)) throw bad('For an exchange, the key is the id and the secret joined by a colon: id:secret.');
  _tokens.delete(name);
  d[name] = { name, origin: o, place, field: place === 'exchange' ? tokenUrl : String(field || (place === 'header' ? 'Authorization' : 'api_key')).slice(0, 300),
    prefix: prefix === undefined || prefix === null ? (place === 'header' && !field ? 'Bearer ' : '') : String(prefix).slice(0, 30),
    who: who === 'everyone' ? 'everyone' : 'host', note: String(note || '').slice(0, 200), key: given, savedAt: new Date().toISOString() };
  write(d);
  return view(d[name]);
}

function remove(name) { const d = all(); if (!d[name]) throw bad('No such key.', 404); delete d[name]; write(d); _tokens.delete(name); return { removed: name }; }

const _tokens = new Map();   // name → { token, until } for keys exchanged for a token: in memory, never written

/** The token for an exchange key: kept until a minute before it expires (an hour when the service does not say). */
async function token(k, { fresh = false } = {}) {
  const cached = _tokens.get(k.name);
  if (!fresh && cached && cached.until > Date.now()) return cached.token;
  const r = await fetch(k.field, { method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Basic ${Buffer.from(k.key).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' });
  const text = await r.text();
  let j = {};
  try { j = JSON.parse(text); } catch { /* said in words */ }
  const pick = o => o && (o.accessToken || o.access_token || o.token);
  const t = pick(j) || pick(j.data);
  if (!r.ok || !t) throw bad(`${k.name}: the service did not give a token (HTTP ${r.status}${j.msg || j.message || j.error ? `: ${j.msg || j.message || j.error_description || j.error}` : ''}) — check the id and secret in Field → Connectors → Keys for services.`, 502);
  const secs = Number(j.expires_in || j.data?.expires_in || j.expiresIn || j.data?.expiresIn) || 3600;
  _tokens.set(k.name, { token: t, until: Date.now() + Math.max(60, secs - 60) * 1000 });
  return t;
}

/**
 * The request `api_call` makes with a named key: the URL and headers it carries, or an error to give the agent.
 * `host`: whether the person the turn acts for holds host (no person on the turn counts as host, as elsewhere).
 */
function apply(name, url, headers, { host = true } = {}) {
  const k = all()[String(name || '').trim().toLowerCase()];
  if (!k) throw bad(`No key named "${name}". Keys for services: ${list().map(x => `${x.name} (${x.origin})`).join(', ') || 'none yet'} — an admin adds one in Field → Connectors → Keys for services.`, 404);
  if (k.who !== 'everyone' && !host) throw bad(`The key "${k.name}" is used only on an admin's turns; an admin can open it to everyone in Field → Connectors.`, 403);
  let u;
  try { u = new URL(url); } catch { throw bad('The url is not an address.'); }
  if (u.origin !== k.origin) throw bad(`The key "${k.name}" is sent only to ${k.origin}, not to ${u.origin}.`, 403);
  if (k.place === 'query') { u.searchParams.set(k.field, k.key); return { url: u.toString(), headers, key: k.key }; }
  if (k.place === 'exchange') return { url: u.toString(), headers, key: k.key, exchange: k };   // the caller asks token() (async)
  return { url: u.toString(), headers: { ...headers, [k.field]: `${k.prefix}${k.key}` }, key: k.key };
}

/** A result with every copy of the key replaced: a service that echoes it does not hand it to the agent. */
const scrub = (text, ...keys) => keys.filter(k => k && k.length >= 4).reduce((t, k) => t.split(k).join('[key]'), String(text));

/** One line for the tool's description: the keys there are, by name and address, never the key. */
function line() {
  const ks = list();
  return ks.length ? ` Keys for services you can name with key (the hub adds them, you never see them): ${ks.map(k => `${k.name} → ${k.origin}${k.note ? ` (${k.note})` : ''}`).join('; ')}.` : '';
}

module.exports = { list, save, remove, apply, token, scrub, line };
