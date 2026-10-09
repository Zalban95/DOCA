'use strict';

/**
 * An iCalendar invitation (RFC 5545, iTIP RFC 5546): what any calendar — Google, Outlook, Apple, Thunderbird — reads
 * as a meeting it can add, update or cancel. One VEVENT per meeting, its UID stable for its life and its SEQUENCE
 * raised by every change (store.js), so a second REQUEST updates the same event and a CANCEL removes it.
 *
 * Times are written in UTC (`…Z`): valid everywhere and unambiguous, and each calendar shows them in its own person's
 * zone. The organizer's zone is kept as X-WR-TIMEZONE for calendars that like to know it; the text of the invite says
 * the time in the recipient's own zone (invite.js, timezones.js). Lines end in CRLF and fold at 75 octets.
 */
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Fold a content line at 75 octets (not characters: a UTF-8 letter is never split). */
function fold(line) {
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const mailto = p => `mailto:${String(p.email || '').replace(/[\r\n]/g, '')}`;
const cn = p => `CN="${String(p.name || p.email || '').replace(/["\r\n]/g, '')}"`;

/**
 * The calendar for one meeting. `method`: REQUEST (new or changed) or CANCEL; `attendees`: [{name, email}] —
 * people without an address are left out of the file (they are told by notice); `url`: the room's link.
 */
function build({ method = 'REQUEST', uid, seq = 0, start, end, title, description = '', url, organizer, attendees = [], tz = null, domain = 'doca.local', now = new Date() }) {
  if (!uid || !start || !end) throw new Error('An invitation needs its id, start and end.');
  const cancel = method === 'CANCEL';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DOCA//Meetings//EN', 'CALSCALE:GREGORIAN', `METHOD:${cancel ? 'CANCEL' : 'REQUEST'}`,
    ...(tz ? [`X-WR-TIMEZONE:${esc(tz)}`] : []),
    'BEGIN:VEVENT',
    `UID:${uid}@${domain}`,
    `SEQUENCE:${Number(seq) || 0}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(title)}`,
    ...(description || url ? [`DESCRIPTION:${esc([description, url ? `Join: ${url}` : ''].filter(Boolean).join('\n\n'))}`] : []),
    ...(url ? [`LOCATION:${esc(url)}`, `URL:${url}`] : []),
    ...(organizer?.email ? [`ORGANIZER;${cn(organizer)}:${mailto(organizer)}`] : []),
    ...attendees.filter(a => a.email).map(a => `ATTENDEE;${cn(a)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:${mailto(a)}`),
    `STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    ...(cancel ? [] : ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'TRIGGER:-PT5M', 'END:VALARM']),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** The meeting row (store.js) as an invitation. */
function forMeeting(m, { method = 'REQUEST', url, organizer, attendees, domain } = {}) {
  return build({ method, uid: m.id, seq: m.seq, start: m.startsAt, end: m.endsAt, title: m.title, description: m.note, url, organizer, attendees, tz: m.tz, domain });
}

module.exports = { build, forMeeting, fold, esc };
