'use strict';

/**
 * Today's plan from the owner's calendar, for the ambient screen: Google Calendar or Microsoft 365, whichever connector
 * is connected (Field → Connectors), read with its read-only scope. The same rule as the connector's tool: the owner's
 * account is shown to a person holding host, or to everyone once the owner opened it (connectors/tools.js). Titles,
 * times and places only; kept two minutes.
 */
const KEEP_MS = 2 * 60000;
let _cache = { at: 0, key: '', value: null };

const SOURCES = {
  google: (from, to, max = 15) => ({ url: `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: String(max) })}`,
    read: j => (j.items || []).filter(e => e.status !== 'cancelled').map(e => ({ title: e.summary || '(no title)', start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, allDay: !e.start?.dateTime, where: e.location || '' })) }),
  microsoft: (from, to, max = 15) => ({ url: `https://graph.microsoft.com/v1.0/me/calendarView?${new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $orderby: 'start/dateTime', $top: String(max), $select: 'subject,start,end,isAllDay,location' })}`,
    headers: { Prefer: 'outlook.timezone="UTC"' },
    read: j => (j.value || []).map(e => ({ title: e.subject || '(no title)', start: `${e.start?.dateTime}Z`, end: `${e.end?.dateTime}Z`, allDay: !!e.isAllDay, where: e.location?.displayName || '' })) }),
};

/** The connectors this person may see a calendar through. */
function usable(person) {
  const vault = require('../connectors/vault');
  return Object.keys(SOURCES).filter(id => vault.get(id)?.accessToken && require('../auth/allot').uses(person, 'connector', id, { opened: vault.get(id)?.who === 'everyone' }));
}

/** Events between two times from every calendar this person may see, oldest first: {events, errors}. */
async function between(ids, from, to, max = 15) {
  const oauth = require('../connectors/oauth');
  const events = [], errors = [];
  for (const id of ids) {
    const s = SOURCES[id](from, to, max);
    try {
      const r = await fetch(s.url, { signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${await oauth.token(id)}`, Accept: 'application/json', ...(s.headers || {}) } });
      if (!r.ok) throw new Error(`answered ${r.status}`);
      events.push(...s.read(await r.json()).map(e => ({ ...e, from: id })));
    } catch (e) { errors.push(`${id}: ${e.message}`); }
  }
  events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return { events, errors };
}

const NONE = 'Connect Google or Microsoft 365 in Field → Connectors to see the day\'s plan here.';

/** Events from now until the end of tomorrow, or {none: why}. */
async function today(person) {
  const ids = usable(person);
  if (!ids.length) return { events: [], none: NONE };
  const key = ids.join(','), now = Date.now();
  if (_cache.key === key && now - _cache.at < KEEP_MS) return _cache.value;
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const { events, errors } = await between(ids, from, new Date(from.getTime() + 2 * 86400000));
  const value = { events: events.filter(e => !e.end || new Date(e.end).getTime() > now).slice(0, 12), errors };
  _cache = { at: now, key, value };
  return value;
}

/** The week from today (the Focused view's Calendar, public/js/focused/agenda.js): `days` days, every event. Kept two minutes. */
let _weekCache = { at: 0, key: '', value: null };
async function week(person, days = 7) {
  const ids = usable(person);
  const n = Math.max(1, Math.min(14, Number(days) || 7));
  if (!ids.length) return { events: [], days: n, none: NONE, sources: [] };
  const key = `${ids.join(',')}:${n}`, now = Date.now();
  if (_weekCache.key === key && now - _weekCache.at < KEEP_MS) return _weekCache.value;
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const { events, errors } = await between(ids, from, new Date(from.getTime() + n * 86400000), 60);
  const value = { events, errors, days: n, from: from.toISOString(), sources: ids };
  _weekCache = { at: now, key, value };
  return value;
}

module.exports = { today, week, usable };
