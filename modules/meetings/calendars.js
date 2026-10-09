'use strict';

/**
 * A person's own calendar, for meetings (asked 2026-10-09: "if I use Google and my colleague uses Microsoft they just
 * have to go in with the call ID and/or link and be notified as they would"). Each person may connect their own Google
 * or Microsoft account here — with the owner's OAuth app (Field → Connectors: the app is the hive's, the account and
 * its tokens are that person's) and only the scope to write events — and a meeting they are in is then created in
 * their calendar as their own event, with the room's link as its place. Without one, they get an iCalendar invite by
 * mail or a notice with "add to calendar" (invite.js): every calendar can take that.
 *
 * Tokens live in DATA_DIR/keys/calendars.json (0600; the keys folder is protected from the agent's file tools,
 * paths.PROTECTED_DIRS), keyed by person. Nothing here is ever sent to a browser: `view()` is the provider and the
 * account's name. DOCA_GOOGLE_API / DOCA_GRAPH_API point the calls at a stub (the tests).
 */
const fs = require('fs');
const path = require('path');

const PROVIDERS = {
  google: { label: 'Google Calendar', scopes: 'openid email https://www.googleapis.com/auth/calendar.events' },
  microsoft: { label: 'Microsoft 365 / Outlook', scopes: 'offline_access User.Read Calendars.ReadWrite' },
};
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const file = () => path.join(path.dirname(require('../paths').CONNECTOR_KEYS_FILE), 'calendars.json');
const googleApi = () => process.env.DOCA_GOOGLE_API || 'https://www.googleapis.com';
const graphApi = () => process.env.DOCA_GRAPH_API || 'https://graph.microsoft.com';

function all() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } }
function write(d) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(d, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file(), 0o600); } catch { /* Windows */ }
}
const get = personId => (personId && all()[personId]) || null;
function put(personId, rec) { const d = all(); if (rec) d[personId] = rec; else delete d[personId]; write(d); }

/** What a page may see of a person's connection, and which providers the hive's apps make possible. */
function view(personId) {
  const r = get(personId), vault = require('../connectors/vault');
  return { connected: r ? { provider: r.provider, label: PROVIDERS[r.provider]?.label, account: r.account || null, since: r.connectedAt } : null,
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, ready: !!vault.get(id)?.clientId })) };
}

/** Where to send the person to connect their own account (the owner's app, the events scope). */
function connect(person, provider, redirectUri) {
  if (!PROVIDERS[provider]) throw bad('provider is google or microsoft.');
  if (!require('../connectors/vault').get(provider)?.clientId)
    throw bad(`${PROVIDERS[provider].label} needs the hive's OAuth app first: an admin adds it in Field → Connectors (the same app connects everyone's calendar).`, 409);
  return require('../connectors/oauth').start(provider, redirectUri, { scopes: PROVIDERS[provider].scopes,
    save: (tokens, account) => put(person.id, { provider, ...tokens, account, connectedAt: new Date().toISOString() }) });
}

const disconnect = personId => put(personId, null);

/** A live token for this person's calendar, refreshed a minute before it expires. */
async function token(personId) {
  const r = get(personId);
  if (!r?.accessToken) throw bad('No calendar connected.', 409);
  if (r.expiresAt && Date.parse(r.expiresAt) - Date.now() < 60000) {
    if (!r.refreshToken) throw bad('The calendar\'s sign-in expired: connect it again in Meetings.', 401);
    const oauth = require('../connectors/oauth');
    const fresh = await oauth.exchange(oauth.spec(r.provider), require('../connectors/vault').get(r.provider) || {}, { grant_type: 'refresh_token', refresh_token: r.refreshToken });
    put(personId, { ...r, ...fresh });
    return fresh.accessToken;
  }
  return r.accessToken;
}

async function call(personId, method, url, body) {
  const r = await fetch(url, { method, signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${await token(personId)}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  if (r.status === 404 && method !== 'POST') return null;   // already gone from their calendar
  if (!r.ok) { const t = await r.text().catch(() => ''); throw bad(`the calendar answered ${r.status}${t ? `: ${t.slice(0, 200)}` : ''}`, 502); }
  return r.status === 204 ? {} : r.json().catch(() => ({}));
}

const text = (m, url) => [m.note, `Join the meeting: ${url}`, `Meeting id: ${m.id}`].filter(Boolean).join('\n\n');

const SHAPES = {
  google: {
    body: (m, url) => ({ summary: m.title, description: text(m, url), location: url, source: { title: m.title, url },
      start: { dateTime: m.startsAt, timeZone: m.tz || 'UTC' }, end: { dateTime: m.endsAt, timeZone: m.tz || 'UTC' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 5 }] }, extendedProperties: { private: { docaMeeting: m.id } } }),
    create: (p, b) => call(p, 'POST', `${googleApi()}/calendar/v3/calendars/primary/events`, b),
    update: (p, id, b) => call(p, 'PATCH', `${googleApi()}/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`, b),
    remove: (p, id) => call(p, 'DELETE', `${googleApi()}/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`),
  },
  microsoft: {
    // Graph takes a wall time and its zone: the UTC instant, said as UTC.
    body: (m, url) => ({ subject: m.title, body: { contentType: 'text', content: text(m, url) }, location: { displayName: url },
      start: { dateTime: m.startsAt.replace(/Z$/, ''), timeZone: 'UTC' }, end: { dateTime: m.endsAt.replace(/Z$/, ''), timeZone: 'UTC' },
      isReminderOn: true, reminderMinutesBeforeStart: 5, transactionId: `${m.id}-${m.seq}` }),
    create: (p, b) => call(p, 'POST', `${graphApi()}/v1.0/me/events`, b),
    update: (p, id, b) => call(p, 'PATCH', `${graphApi()}/v1.0/me/events/${encodeURIComponent(id)}`, b),
    remove: (p, id) => call(p, 'DELETE', `${graphApi()}/v1.0/me/events/${encodeURIComponent(id)}`),
  },
};

/**
 * Put the meeting in this person's own calendar, or change or remove it there: { provider, eventId } or throws.
 * `eventId`: the event this person's calendar already has for it.
 */
async function sync(personId, m, url, { eventId = null, cancel = false } = {}) {
  const r = get(personId);
  if (!r) return null;
  const s = SHAPES[r.provider];
  if (cancel) { if (eventId) await s.remove(personId, eventId); return { provider: r.provider, eventId: null }; }
  if (eventId) { await s.update(personId, eventId, s.body(m, url)); return { provider: r.provider, eventId }; }
  const made = await s.create(personId, s.body(m, url));
  return { provider: r.provider, eventId: made?.id || null };
}

module.exports = { view, connect, disconnect, sync, get, PROVIDERS, _put: put };
