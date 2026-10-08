'use strict';

/**
 * What a calendar tool says, for both calendar ways (a secret address, CalDAV): the range a call asks for — "today",
 * or from/to as dates or times, read on this host's clock — and the events as lines a model reads at a glance, in
 * this host's time with the zone named once.
 */
const zones = require('../../calendar/zones');

const DAY = 86400000;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Local midnight of the day an instant falls on, on this host's clock. */
function midnight(ms) {
  const w = zones.toWall(ms, zones.local());
  return zones.toInstant({ y: w.y, m: w.m, d: w.d }, zones.local());
}

/** A from/to argument: YYYY-MM-DD (local midnight) or an ISO time. */
function instant(v, what) {
  const s = String(v).trim();
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (d) return zones.toInstant({ y: +d[1], m: +d[2], d: +d[3] }, zones.local());
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw bad(`${what} is a date (2026-10-08) or a time (2026-10-08T09:00).`);
  return t;
}

/** { from, to } in ms for an action: today (today and tomorrow when `days` says 2), or a range up to 400 days. */
function range({ action, from, to, days } = {}) {
  const start = from ? instant(from, 'from') : midnight(Date.now());
  const end = to ? instant(to, 'to') : start + Math.min(400, Math.max(1, Number(days) || (action === 'today' ? 1 : 7))) * DAY;
  if (end <= start) throw bad('to comes after from.');
  if (end - start > 400 * DAY) throw bad('Ask for at most 400 days at a time.');
  return { from: start, to: end };
}

const local = ms => new Date(ms).toLocaleString('sv-SE', { timeZone: zones.local(), hour12: false }).slice(0, 16);

/** The events as lines: when, what, where; `query` keeps only those whose title, place or notes hold it. */
function lines(events, { query, limit = 100, label, from, to } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const kept = (q ? events.filter(e => `${e.title} ${e.where} ${e.description}`.toLowerCase().includes(q)) : events).slice(0, Math.min(500, Number(limit) || 100));
  const head = `${label}: ${kept.length} event${kept.length === 1 ? '' : 's'} from ${local(from)} to ${local(to)} (times in ${zones.local()})${q ? `, matching "${q}"` : ''}.`;
  return [head, ...kept.map(e => {
    const when = e.allDay ? `${e.start}${Date.parse(e.end) - Date.parse(e.start) > DAY ? ` → ${new Date(Date.parse(e.end) - DAY).toISOString().slice(0, 10)}` : ''} (all day)`
      : `${local(Date.parse(e.start))}–${local(Date.parse(e.end)).slice(11)}`;
    const notes = e.description ? ` — ${e.description.replace(/\s+/g, ' ').slice(0, 200)}` : '';
    return `- ${when} ${e.title}${e.where ? ` @ ${e.where}` : ''}${e.recurring ? ' (repeats)' : ''}${notes}`;
  })].join('\n');
}

module.exports = { range, lines, midnight, DAY };
