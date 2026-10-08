'use strict';

/**
 * Reading iCalendar (RFC 5545) — as much as a calendar feed or a CalDAV answer needs, with no dependency: lines unfolded,
 * properties with their parameters (quoted values may hold ":" and ";"), text unescaped, VEVENTs with their start
 * and end (a date, a UTC time, a time in a TZID, or a floating time read in the calendar's own zone), duration,
 * RRULE, EXDATE and RECURRENCE-ID; VTIMEZONEs only as a fallback offset for a TZID the runtime does not know.
 * `events(text, from, to)` gives the occurrences that overlap [from, to), recurring ones expanded (recur.js).
 */
const zones = require('./zones');
const recur = require('./recur');

const DAY = 86400000;

/** One content line → { name, params, value }. */
function property(line) {
  let i = 0, q = false;
  const head = [];
  let cur = '';
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    if (!q && (c === ';' || c === ':')) { head.push(cur); cur = ''; if (c === ':') { i++; break; } continue; }
    cur += c;
  }
  if (i >= line.length && !line.includes(':')) return null;
  const params = {};
  for (const p of head.slice(1)) { const k = p.indexOf('='); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ''); }
  return { name: String(head[0] || '').toUpperCase(), params, value: line.slice(i) };
}

const text = v => String(v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** Components as nested { type, props: [property], children }. */
function tree(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const root = { type: 'ROOT', props: [], children: [] };
  const stack = [root];
  for (const line of lines) {
    if (!line.trim()) continue;
    const p = property(line);
    if (!p) continue;
    if (p.name === 'BEGIN') { const c = { type: p.value.trim().toUpperCase(), props: [], children: [] }; stack.at(-1).children.push(c); stack.push(c); }
    else if (p.name === 'END') { if (stack.length > 1) stack.pop(); }
    else stack.at(-1).props.push(p);
  }
  return root;
}

const first = (c, name) => c.props.find(p => p.name === name) || null;

/** A DATE or DATE-TIME → { ms, allDay, zone } (zone: IANA name, fixed minutes, or 'UTC'), or null. */
function when(p, cal) {
  if (!p) return null;
  const v = p.value.trim().split(',')[0];
  const d = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!d) return null;
  const w = { y: +d[1], m: +d[2], d: +d[3], h: +(d[4] || 0), mi: +(d[5] || 0), s: +(d[6] || 0) };
  if (!d[4] || p.params.VALUE === 'DATE') return { ms: Date.UTC(w.y, w.m - 1, w.d), allDay: true, zone: 'UTC' };
  const zone = d[7] ? 'UTC' : p.params.TZID ? (zones.resolve(p.params.TZID) ?? cal.fixed[p.params.TZID] ?? 'UTC') : cal.zone;
  return { ms: zones.toInstant(w, zone), allDay: false, zone };
}

/** Every value of a list property (EXDATE may repeat and hold a comma list) as instants. */
function many(c, name, cal) {
  const out = [];
  for (const p of c.props.filter(x => x.name === name)) for (const v of p.value.split(',')) { const t = when({ ...p, value: v }, cal); if (t) out.push(t.ms); }
  return out;
}

/** "P1DT2H30M", "PT45M", "P2W" → ms. */
function duration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * (((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 + +(m[4] || 0)) * 3600 + +(m[5] || 0) * 60 + +(m[6] || 0)) * 1000;
}

/** The calendar: its name, zone, and each VEVENT read. */
function parse(source) {
  const root = tree(source);
  const vcal = root.children.find(c => c.type === 'VCALENDAR') || root;
  const fixed = {};
  for (const tz of vcal.children.filter(c => c.type === 'VTIMEZONE')) {
    const id = first(tz, 'TZID')?.value.trim();
    const std = tz.children.find(c => c.type === 'STANDARD') || tz.children[0];
    const off = std && zones.offsetMinutes(first(std, 'TZOFFSETTO')?.value);
    if (id && off !== null && off !== undefined) fixed[id] = off;
  }
  const calZone = zones.resolve(first(vcal, 'X-WR-TIMEZONE')?.value) || zones.local();
  const cal = { zone: calZone, fixed };
  const events = [];
  for (const c of vcal.children.filter(x => x.type === 'VEVENT')) {
    const start = when(first(c, 'DTSTART'), cal);
    if (!start) continue;
    const endP = when(first(c, 'DTEND'), cal);
    const dur = endP ? endP.ms - start.ms : duration(first(c, 'DURATION')?.value) ?? (start.allDay ? DAY : 0);
    events.push({
      uid: first(c, 'UID')?.value.trim() || '', title: text(first(c, 'SUMMARY')?.value) || '(no title)', where: text(first(c, 'LOCATION')?.value),
      description: text(first(c, 'DESCRIPTION')?.value), status: (first(c, 'STATUS')?.value || '').trim().toUpperCase(),
      start, dur: Math.max(0, dur), rrule: recur.rule(first(c, 'RRULE')?.value), exdates: many(c, 'EXDATE', cal),
      rdates: many(c, 'RDATE', cal), recurrenceId: when(first(c, 'RECURRENCE-ID'), cal)?.ms ?? null,
    });
  }
  return { name: text(first(vcal, 'X-WR-CALNAME')?.value) || null, zone: calZone, events };
}

const localDay = ms => { const w = zones.toWall(ms, zones.local()); return Date.UTC(w.y, w.m - 1, w.d); };
const iso = (ms, allDay) => (allDay ? new Date(ms).toISOString().slice(0, 10) : new Date(ms).toISOString());

/**
 * The occurrences overlapping [from, to) (ms), sorted, each { uid, title, start, end, allDay, where, description,
 * recurring }: an all-day event's dates as YYYY-MM-DD (end exclusive), a timed one's as UTC ISO times. A changed
 * instance (RECURRENCE-ID) replaces the one it changes; a cancelled one is left out. `max` caps the list.
 */
function events(source, from, to, { max = 500 } = {}) {
  const cal = typeof source === 'string' ? parse(source) : source;
  const overrides = new Map();   // uid → Set of instants moved or cancelled
  for (const e of cal.events) if (e.recurrenceId !== null) { if (!overrides.has(e.uid)) overrides.set(e.uid, new Set()); overrides.get(e.uid).add(e.recurrenceId); }
  const out = [];
  const push = (e, ms, recurring) => {
    // An all-day event's date is a day wherever it is read: it overlaps when its days touch the range's days, read on
    // this host's calendar (an event "on the 8th" is on the 8th here, not from 02:00 in UTC+2).
    const a = ms, b = ms + (e.dur || (e.start.allDay ? DAY : 0));
    const overlaps = e.start.allDay ? b > localDay(from) && a < localDay(to - 1) + DAY : (b > from || (b === a && a >= from)) && a < to;
    if (overlaps) out.push({ uid: e.uid, title: e.title, start: iso(a, e.start.allDay), end: iso(b, e.start.allDay), allDay: e.start.allDay, where: e.where, description: e.description, recurring });
  };
  for (const e of cal.events) {
    if (e.status === 'CANCELLED') continue;
    if (e.recurrenceId !== null || (!e.rrule && !e.rdates.length)) { push(e, e.start.ms, e.recurrenceId !== null); continue; }
    const skip = new Set([...e.exdates, ...(overrides.get(e.uid) || [])]);
    const starts = e.rrule ? recur.expand(e.rrule, e.start, from - e.dur - 2 * DAY, to + DAY) : [e.start.ms];
    for (const ms of new Set([...starts, ...e.rdates])) if (!skip.has(ms)) push(e, ms, true);
  }
  out.sort((x, y) => Date.parse(x.start) - Date.parse(y.start) || x.title.localeCompare(y.title));
  return out.slice(0, max);
}

module.exports = { parse, events, tree, property, duration };
