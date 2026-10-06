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
  google: (from, to) => ({ url: `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '15' })}`,
    read: j => (j.items || []).filter(e => e.status !== 'cancelled').map(e => ({ title: e.summary || '(no title)', start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, allDay: !e.start?.dateTime, where: e.location || '' })) }),
  microsoft: (from, to) => ({ url: `https://graph.microsoft.com/v1.0/me/calendarView?${new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $orderby: 'start/dateTime', $top: '15', $select: 'subject,start,end,isAllDay,location' })}`,
    headers: { Prefer: 'outlook.timezone="UTC"' },
    read: j => (j.value || []).map(e => ({ title: e.subject || '(no title)', start: `${e.start?.dateTime}Z`, end: `${e.end?.dateTime}Z`, allDay: !!e.isAllDay, where: e.location?.displayName || '' })) }),
};

/** The connectors this person may see a calendar through. */
function usable(person) {
  const vault = require('../connectors/vault');
  const host = !person?.id || require('../auth/rights').can(person.role, 'host');
  return Object.keys(SOURCES).filter(id => vault.get(id)?.accessToken && (host || vault.get(id)?.who === 'everyone'));
}

/** Events from now until the end of tomorrow, or {none: why}. */
async function today(person) {
  const ids = usable(person);
  if (!ids.length) return { events: [], none: 'Connect Google or Microsoft 365 in Field → Connectors to see the day\'s plan here.' };
  const key = ids.join(','), now = Date.now();
  if (_cache.key === key && now - _cache.at < KEEP_MS) return _cache.value;
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 2 * 86400000);
  const oauth = require('../connectors/oauth');
  const events = [], errors = [];
  for (const id of ids) {
    const s = SOURCES[id](from, to);
    try {
      const r = await fetch(s.url, { signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${await oauth.token(id)}`, Accept: 'application/json', ...(s.headers || {}) } });
      if (!r.ok) throw new Error(`answered ${r.status}`);
      events.push(...s.read(await r.json()).map(e => ({ ...e, from: id })));
    } catch (e) { errors.push(`${id}: ${e.message}`); }
  }
  events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const value = { events: events.filter(e => !e.end || new Date(e.end).getTime() > now).slice(0, 12), errors };
  _cache = { at: now, key, value };
  return value;
}

module.exports = { today, usable };
