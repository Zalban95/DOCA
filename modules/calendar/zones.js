'use strict';

/**
 * Time zones for calendars (ICS, CalDAV), with the runtime's own tz database (`Intl`) — no dependency. A TZID is an
 * IANA name (Google, iCloud, Fastmail), a Windows name (Outlook: "W. Europe Standard Time"), or a name with a vendor's
 * prefix ("/mozilla.org/20050126_1/Europe/Rome"); one none of those resolves falls back to the fixed offset its own
 * VTIMEZONE gives, else to UTC. A wall-clock time in a zone becomes an instant by asking Intl what the zone's clock
 * reads at a guess and correcting by the difference — twice, so a time near a DST change lands right.
 */

// The Windows zone names Outlook and Exchange write, by the IANA zone CLDR maps each to (windowsZones.xml, territory 001).
const WINDOWS = {
  'Dateline Standard Time': 'Etc/GMT+12', 'Hawaiian Standard Time': 'Pacific/Honolulu', 'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles', 'US Mountain Standard Time': 'America/Phoenix', 'Mountain Standard Time': 'America/Denver',
  'Central Standard Time': 'America/Chicago', 'Central America Standard Time': 'America/Guatemala', 'Canada Central Standard Time': 'America/Regina',
  'Mexico Standard Time': 'America/Mexico_City', 'Central Standard Time (Mexico)': 'America/Mexico_City', 'Eastern Standard Time': 'America/New_York',
  'US Eastern Standard Time': 'America/Indianapolis', 'SA Pacific Standard Time': 'America/Bogota', 'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns', 'E. South America Standard Time': 'America/Sao_Paulo', 'Argentina Standard Time': 'America/Buenos_Aires',
  'UTC': 'UTC', 'Coordinated Universal Time': 'UTC', 'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest', 'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw', 'W. Central Africa Standard Time': 'Africa/Lagos', 'GTB Standard Time': 'Europe/Bucharest',
  'E. Europe Standard Time': 'Europe/Chisinau', 'FLE Standard Time': 'Europe/Kiev', 'Israel Standard Time': 'Asia/Jerusalem',
  'South Africa Standard Time': 'Africa/Johannesburg', 'Egypt Standard Time': 'Africa/Cairo', 'Turkey Standard Time': 'Europe/Istanbul',
  'Russian Standard Time': 'Europe/Moscow', 'Arab Standard Time': 'Asia/Riyadh', 'Arabian Standard Time': 'Asia/Dubai', 'Iran Standard Time': 'Asia/Tehran',
  'Pakistan Standard Time': 'Asia/Karachi', 'India Standard Time': 'Asia/Calcutta', 'Nepal Standard Time': 'Asia/Katmandu',
  'Bangladesh Standard Time': 'Asia/Dhaka', 'SE Asia Standard Time': 'Asia/Bangkok', 'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore', 'Taipei Standard Time': 'Asia/Taipei', 'W. Australia Standard Time': 'Australia/Perth',
  'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul', 'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Eastern Standard Time': 'Australia/Sydney', 'E. Australia Standard Time': 'Australia/Brisbane', 'Tasmania Standard Time': 'Australia/Hobart',
  'New Zealand Standard Time': 'Pacific/Auckland',
};

const _valid = new Map();
function valid(name) {
  if (!_valid.has(name)) { try { new Intl.DateTimeFormat('en-US', { timeZone: name }); _valid.set(name, true); } catch { _valid.set(name, false); } }
  return _valid.get(name);
}

/** The IANA zone a TZID names, or null. */
function resolve(tzid) {
  const s = String(tzid || '').trim().replace(/^"|"$/g, '');
  if (!s) return null;
  if (valid(s)) return s;
  if (WINDOWS[s]) return WINDOWS[s];
  const tail = /([A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/.exec(s);   // "/mozilla.org/…/Europe/Rome", "(UTC+01:00) Europe/Rome"
  return tail && valid(tail[1]) ? tail[1] : null;
}

const _fmt = new Map();
function parts(zone, ms) {
  if (!_fmt.has(zone)) _fmt.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  const o = {};
  for (const p of _fmt.get(zone).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o;
}

/** The zone's offset from UTC at an instant, in ms. */
function offset(zone, ms) {
  const p = parts(zone, ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant (ms) a wall-clock time {y, m (1–12), d, h, mi, s} names in a zone: an IANA name, or a fixed offset in
 * minutes (a VTIMEZONE nothing else resolved), or null for UTC.
 */
function toInstant(w, zone) {
  const wall = Date.UTC(w.y, w.m - 1, w.d, w.h || 0, w.mi || 0, w.s || 0);
  if (zone === null || zone === undefined || zone === 'UTC') return wall;
  if (typeof zone === 'number') return wall - zone * 60000;
  let guess = wall - offset(zone, wall);
  guess = wall - offset(zone, guess);
  return guess;
}

/** The wall-clock time an instant reads in a zone (for expanding a recurrence in the event's own time). */
function toWall(ms, zone) {
  if (zone === null || zone === undefined || zone === 'UTC' || typeof zone === 'number') {
    const d = new Date(ms + (typeof zone === 'number' ? zone * 60000 : 0));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
  const p = parts(zone, ms);
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

/** "+0100" / "-0530" → minutes. */
const offsetMinutes = s => { const m = /^([+-])(\d{2})(\d{2})/.exec(String(s || '').trim()); return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null; };

/** The host's own zone, for "today" and floating times. */
const local = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

module.exports = { resolve, toInstant, toWall, offset, offsetMinutes, local, WINDOWS };
