'use strict';

/**
 * One request to a person's own account, with that account's token, only to its service's own API: Google's
 * (DOCA_GOOGLE_API, default https://www.googleapis.com — Calendar and Gmail both answer there) or Microsoft Graph
 * (DOCA_GRAPH_API, default https://graph.microsoft.com). The two variables point the calls at a stub in the tests, as
 * meetings/calendars.js does. Anything else — a delta link a stub or a service handed back pointing elsewhere — is
 * refused before the token is sent.
 */
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const BASE = { google: () => process.env.DOCA_GOOGLE_API || 'https://www.googleapis.com', microsoft: () => process.env.DOCA_GRAPH_API || 'https://graph.microsoft.com' };

const base = provider => BASE[provider]();

/** `rec` is the account's record (store.js); `url` a path on its API or a full address there. */
async function call(rec, method, url, { body, headers = {}, query } = {}) {
  const root = base(rec.provider);
  const u = new URL(/^https?:\/\//.test(url) ? url : `${root}${url}`);
  if (u.origin !== new URL(root).origin) throw bad(`${rec.provider}'s token goes only to ${root} — not ${u.origin}.`);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  const tok = await require('./store').token(rec.personId, rec.id);
  const r = await fetch(u, { method, signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', 'User-Agent': 'DOCA', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined }).catch(e => { throw bad(`${rec.account || rec.provider}: the service could not be reached (${e.message})`, 502); });
  if (r.status === 204 || r.status === 202) return {};
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : {}; } catch { j = { text }; }
  if (!r.ok) {
    const why = j?.error?.message || j?.error_description || (typeof j?.error === 'string' ? j.error : '') || text.slice(0, 200);
    throw bad(`${rec.account || rec.provider} answered ${r.status}${why ? `: ${why}` : ''}`, r.status === 404 ? 404 : r.status === 403 ? 403 : 502);
  }
  return j;
}

module.exports = { call, base };
