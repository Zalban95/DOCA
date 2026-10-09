'use strict';

/**
 * When a schedule runs (TODO H7.1): `every` a number of minutes, or a five-field cron expression
 * (minute hour day-of-month month day-of-week; `*`, lists, ranges and steps) — the format every other scheduler
 * reads, so a schedule moves to cron, systemd or Task Scheduler as it is. Read on the clock of `when.tz` (the
 * person's zone, modules/timezones.js) when it has one, else the host's: "09:00" from a person in Rome on a hub in
 * UTC ran at 11:00 their time (deep test B, C10).
 */
const zones = require('../timezones');
const FIELDS = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];   // day-of-week: Sunday is 0 or 7

function parseField(text, [lo, hi], i) {
  const out = new Set();
  for (const part of String(text).split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`"${part}": the step must be a whole number above 0`);
    let [a, b] = range === '*' ? [lo, hi] : range.split('-').map(Number);
    if (b === undefined) b = stepText ? hi : a;
    if (![a, b].every(Number.isInteger) || a < lo || b > hi || a > b) throw new Error(`"${part}" is outside ${lo}–${hi}`);
    for (let v = a; v <= b; v += step) out.add(i === 4 && v === 7 ? 0 : v);
  }
  return out;
}

function parseCron(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('A cron expression has five fields: minute hour day-of-month month day-of-week (e.g. "0 9 * * 1-5").');
  const sets = parts.map((p, i) => parseField(p, FIELDS[i], i));
  return { sets, domAny: parts[2] === '*', dowAny: parts[4] === '*' };
}

/**
 * The first minute strictly after `from` that matches. Day-of-month and day-of-week match either, as cron does.
 * With `tz` the minutes are walked on that zone's clock (a Date whose UTC fields are the wall clock), then turned
 * back into the real moment.
 */
function nextCron(expr, from = new Date(), tz = null) {
  const { sets: [min, hour, dom, mon, dow], domAny, dowAny } = parseCron(expr);
  const zone = zones.valid(tz);
  const t = zone ? zones.toWall(from, zone) : new Date(from.getTime());
  const g = zone ? { s: 'setUTCSeconds', m: 'getUTCMinutes', sm: 'setUTCMinutes', h: 'getUTCHours', d: 'getUTCDate', w: 'getUTCDay', mo: 'getUTCMonth' }
    : { s: 'setSeconds', m: 'getMinutes', sm: 'setMinutes', h: 'getHours', d: 'getDate', w: 'getDay', mo: 'getMonth' };
  t[g.s](0, 0); t[g.sm](t[g.m]() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const day = t[g.d](), wd = t[g.w]();
    const dayOk = domAny && dowAny ? true : domAny ? dow.has(wd) : dowAny ? dom.has(day) : dom.has(day) || dow.has(wd);
    if (mon.has(t[g.mo]() + 1) && dayOk && hour.has(t[g.h]()) && min.has(t[g.m]())) return zone ? zones.fromWall(t, zone) : t;
    t[g.sm](t[g.m]() + 1);
  }
  throw new Error(`"${expr}" never matches within a year.`);
}

/** @param {{every?: number, cron?: string}} when */
function next(when, from = new Date()) {
  if (when.cron) return nextCron(when.cron, from, when.tz);
  // Once, at a moment (a reminder): that moment while it is ahead; after it, nothing.
  if (when.at !== undefined) {
    const t = Date.parse(when.at);
    if (!Number.isFinite(t)) throw new Error('at is a date and time, ISO 8601 (2026-10-07T18:00).');
    return t > from.getTime() ? new Date(t) : null;
  }
  if (when.self) return new Date(from.getTime() + 2000);   // a loop that goes again as soon as a run ends (loop.js)
  const mins = Number(when.every);
  if (!Number.isFinite(mins) || mins < 1) throw new Error('every is a number of minutes, at least 1.');
  return new Date(from.getTime() + mins * 60000);
}

/** In words, for the agent; a time on `tz`'s clock (the person's), else the schedule's own zone, else the host's. */
function describe(when, tz = null) {
  const zone = zones.valid(tz) || zones.valid(when.tz) || zones.hostZone();
  if (when.cron) return `cron ${when.cron} (${zones.valid(when.tz) || `${zones.hostZone()}, the hub's time`})`;
  if (when.at !== undefined) return `once, ${zones.human(new Date(when.at), zone)}`;
  if (when.self) return 'again as soon as each run ends';
  const m = Number(when.every);
  return m % 1440 === 0 ? `every ${m / 1440} day${m === 1440 ? '' : 's'}` : m % 60 === 0 ? `every ${m / 60} hour${m === 60 ? '' : 's'}` : `every ${m} minute${m === 1 ? '' : 's'}`;
}

module.exports = { next, nextCron, parseCron, describe };
