'use strict';

/**
 * Recurrence rules (RFC 5545 §3.3.10), the part calendars people share actually use: FREQ DAILY, WEEKLY, MONTHLY and
 * YEARLY with INTERVAL, COUNT, UNTIL, BYDAY (with an ordinal in a month or year: 2TU, -1FR), BYMONTHDAY, BYMONTH and
 * WKST. Occurrences are made in the event's own wall-clock time and only then turned into instants, so a weekly
 * 09:00 meeting stays at 09:00 across a change to summer time. BYSETPOS, BYYEARDAY, BYWEEKNO and the sub-daily
 * frequencies are not read: such an event shows its first occurrence only, which `rule()` marks.
 */
const zones = require('./zones');

const DAY = 86400000;
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const MAX_STEPS = 20000;   // outer steps of a rule: decades of a daily event, and an end for a rule that never matches

/** An RRULE value → { freq, interval, count, until, byday: [{n, wd}], bymonthday, bymonth, wkst } or null. */
function rule(value) {
  if (!value) return null;
  const r = {};
  for (const part of String(value).split(';')) { const [k, v] = part.split('='); if (k && v !== undefined) r[k.trim().toUpperCase()] = v.trim(); }
  const freq = String(r.FREQ || '').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq) || r.BYSETPOS || r.BYYEARDAY || r.BYWEEKNO) return { unsupported: true };
  const until = r.UNTIL && /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(r.UNTIL);
  return {
    freq, interval: Math.max(1, Number(r.INTERVAL) || 1), count: r.COUNT ? Math.max(1, Number(r.COUNT) || 1) : null,
    // UNTIL is inclusive; a date alone means through that whole day.
    until: until ? (until[4] ? Date.UTC(+until[1], +until[2] - 1, +until[3], +until[4], +until[5], +until[6]) : Date.UTC(+until[1], +until[2] - 1, +until[3]) + DAY - 1) : null,
    byday: r.BYDAY ? r.BYDAY.split(',').map(x => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(x.trim())).filter(Boolean).map(m => ({ n: m[1] ? Number(m[1]) : 0, wd: WD[m[2].toUpperCase()] })) : null,
    bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number).filter(n => n && Math.abs(n) <= 31) : null,
    bymonth: r.BYMONTH ? r.BYMONTH.split(',').map(Number).filter(n => n >= 1 && n <= 12) : null,
    wkst: WD[String(r.WKST || 'MO').toUpperCase()] ?? 1,
  };
}

const dayOf = (y, m, d) => Date.UTC(y, m - 1, d) / DAY;              // a day number (days since 1970-01-01)
const weekday = day => new Date(day * DAY).getUTCDay();
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The days of month (y, m) the rule picks, in order. */
function monthDays(y, m, r, startD) {
  const n = daysIn(y, m);
  let days;
  if (r.byday) {
    days = [];
    for (const { n: ord, wd } of r.byday) {
      const all = [];
      for (let d = 1; d <= n; d++) if (weekday(dayOf(y, m, d)) === wd) all.push(d);
      if (!ord) days.push(...all);
      else { const pick = ord > 0 ? all[ord - 1] : all[all.length + ord]; if (pick) days.push(pick); }
    }
    if (r.bymonthday) { const want = new Set(r.bymonthday.map(d => (d > 0 ? d : n + d + 1))); days = days.filter(d => want.has(d)); }
  } else if (r.bymonthday) days = r.bymonthday.map(d => (d > 0 ? d : n + d + 1)).filter(d => d >= 1 && d <= n);
  else days = startD <= n ? [startD] : [];   // the 31st recurs only in months that have one (RFC 5545)
  return [...new Set(days)].sort((a, b) => a - b).map(d => dayOf(y, m, d));
}

/** Candidate days, in order, from the start's day on: the rule's days before COUNT and UNTIL are applied. */
function* days(r, s) {
  const start = dayOf(s.y, s.m, s.d);
  if (r.freq === 'DAILY') {
    for (let k = 0; k < MAX_STEPS * 10; k++) {
      const day = start + k * r.interval;
      if (r.byday && !r.byday.some(b => b.wd === weekday(day))) continue;
      if (r.bymonth && !r.bymonth.includes(new Date(day * DAY).getUTCMonth() + 1)) continue;
      yield day;
    }
  } else if (r.freq === 'WEEKLY') {
    const rel = wd => (wd - r.wkst + 7) % 7;
    const weekStart = start - rel(weekday(start));
    const wds = [...new Set((r.byday || [{ wd: weekday(start) }]).map(b => b.wd))].sort((a, b) => rel(a) - rel(b));
    for (let w = 0; w < MAX_STEPS; w++) for (const wd of wds) { const day = weekStart + w * 7 * r.interval + rel(wd); if (day >= start) yield day; }
  } else if (r.freq === 'MONTHLY') {
    for (let k = 0; k < MAX_STEPS; k++) {
      const ym = s.y * 12 + (s.m - 1) + k * r.interval, y = Math.floor(ym / 12), m = (ym % 12) + 1;
      if (r.bymonth && !r.bymonth.includes(m)) continue;
      for (const day of monthDays(y, m, r, s.d)) if (day >= start) yield day;
    }
  } else {
    for (let k = 0; k < MAX_STEPS; k++) {
      const y = s.y + k * r.interval;
      for (const m of r.bymonth || [s.m]) {
        // BYDAY in a yearly rule with BYMONTH is per month (4TH in November); without BYMONTH, the start's month.
        const picked = r.byday || r.bymonthday ? monthDays(y, m, r, s.d) : (s.d <= daysIn(y, m) ? [dayOf(y, m, s.d)] : []);
        for (const day of picked) if (day >= start) yield day;
      }
    }
  }
}

/**
 * The instants (ms) the rule starts an occurrence at, from `start` ({ms, allDay, zone}) through `to`, keeping those
 * at or after `from`. COUNT counts from the first occurrence, before the range too. The first occurrence is DTSTART
 * itself, as RFC 5545 has it, whether or not the rule would pick it.
 */
function expand(r, start, from, to) {
  if (!r || r.unsupported) return start.ms >= from && start.ms < to ? [start.ms] : [];
  const wall = start.allDay ? zones.toWall(start.ms, 'UTC') : zones.toWall(start.ms, start.zone);
  const out = [];
  let n = 0;
  const take = ms => {
    n++;
    if (ms >= from && ms < to) out.push(ms);
  };
  take(start.ms);
  for (const day of days(r, wall)) {
    if (r.count && n >= r.count) break;
    const d = new Date(day * DAY);
    const ms = start.allDay ? day * DAY
      : zones.toInstant({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: wall.h, mi: wall.mi, s: wall.s }, start.zone);
    if (ms <= start.ms) continue;
    if (r.until !== null && ms > r.until) break;
    if (ms >= to) break;
    take(ms);
  }
  return out;
}

module.exports = { rule, expand };
