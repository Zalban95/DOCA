'use strict';

/**
 * A connected service is a tool (TODO H9.3): `connector_<id>`, present only while that connector is connected (the
 * tool list is rebuilt every step, like MCP servers'), so a level's tool policy, a grant, a specialist's tool list
 * and the approval gate all apply to it by name — "scoped per agent and level" without a second mechanism. Connected
 * by OAuth, a call is one HTTP request to one of the service's own API hosts with the connected account's token;
 * connected another way (a calendar's secret address, a mailbox's app password, CalDAV — ways/), the way's own
 * actions. Either way the answer is the service's, framed as other people's words (untrusted.sourceOf), because it is:
 * mail, events and issues others wrote.
 */
const oauth = require('./oauth');
const vault = require('./vault');
const ways = require('./ways');

const PREFIX = 'connector_';
const MAX = 60000;
const connected = () => Object.entries(vault.all()).filter(([, r]) => vault.isConnected(r)).map(([id]) => id);
const is = name => typeof name === 'string' && name.startsWith(PREFIX) && connected().includes(name.slice(PREFIX.length));
const wayOf = rec => (rec?.via && rec.via !== 'oauth' ? ways.get(rec.via) : null);
const labelOf = (id, rec) => rec?.label || require('./services').labelOf(id, rec) || id;

function def(id) {
  const rec = vault.get(id) || {};
  const way = wayOf(rec);
  if (way) return way.def(id, rec, labelOf(id, rec));
  const s = oauth.spec(id);
  return { name: `${PREFIX}${id}`, description: `Call the ${s.label} API as ${rec.account || 'the connected account'}: one request to ${s.api.join(' or ')} `
    + `with that account's sign-in${rec.scopes ? ` (scopes: ${rec.scopes})` : ''}. Read what the service's own API reference says for the path; `
    + `GET to read, other methods change things in the account and are asked about like any change.${s.hint ? ` ${s.hint}` : ''}`,
  parameters: { type: 'object', properties: {
    method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'GET (default) reads.' },
    path: { type: 'string', description: `A path on ${s.api[0]} (e.g. "/user"), or a full address on one of: ${s.api.join(', ')}.` },
    query: { type: 'object', description: 'Query parameters.' },
    body: { type: 'object', description: 'A JSON body, for POST, PUT and PATCH.' },
  }, required: ['path'] } };
}

const describe = () => connected().map(id => { const d = def(id); return { name: d.name, description: d.description.split(': ')[0], danger: false }; });
const schemas = (off = []) => connected().map(def).filter(d => !off.includes(d.name)).map(d => ({ type: 'function', function: d }));

async function call(name, args = {}, ctx = {}) {
  const id = name.slice(PREFIX.length), rec = vault.get(id) || {};
  const way = wayOf(rec), label = way ? labelOf(id, rec) : oauth.spec(id).label;
  // The owner's account: only a person holding host uses it through the agent, unless the owner opened it to everyone
  // or it is allotted to this person (auth/allot.js, S13).
  // No person on the turn (a test, a pre-accounts call) is not narrowed, as everywhere (auth/permits.js).
  if (!require('../auth/allot').uses(ctx.user, 'connector', id, { opened: rec.who === 'everyone' }))
    return `Error: ${label} is connected as an admin's account, for people who hold host; ask an admin to open it to everyone in Field → Connectors.`;
  if (way) {
    try { return String(await way.run(id, rec, args || {}, label)); } catch (e) { return `Error: ${e.message}`; }
  }
  const { method = 'GET', path = '', query, body } = args || {};
  const s = oauth.spec(id);
  const url = new URL(/^https?:\/\//.test(path) ? path : `${s.api[0]}${path.startsWith('/') ? '' : '/'}${path}`);
  if (!s.api.some(a => url.origin === new URL(a).origin)) return `Error: ${s.label}'s token goes only to ${s.api.join(', ')} — not ${url.origin}.`;
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
  const send = async tok => fetch(url, { method, signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', 'User-Agent': 'DOCA', ...s.headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body && method !== 'GET' ? JSON.stringify(body) : undefined });
  let r;
  try { r = await send(await oauth.token(id)); } catch (e) { return `Error: ${e.message}`; }
  const text = await r.text();
  return `${method} ${url.pathname}${url.search} → ${r.status}\n${text.length > MAX ? `${text.slice(0, MAX)}\n… (${text.length} characters; ask for less with query parameters)` : text}`;
}

module.exports = { is, describe, schemas, call, PREFIX, connected };
