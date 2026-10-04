'use strict';

/**
 * When a schedule runs (TODO H7.1): `every` a number of minutes, or a five-field cron expression
 * (minute hour day-of-month month day-of-week; `*`, lists, ranges and steps), in the host's local time —
 * the format every other scheduler reads, so a schedule moves to cron, systemd or Task Scheduler as it is.
 */
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

/** The first minute strictly after `from` that matches. Day-of-month and day-of-week match either, as cron does. */
function nextCron(expr, from = new Date()) {
  const { sets: [min, hour, dom, mon, dow], domAny, dowAny } = parseCron(expr);
  const t = new Date(from.getTime());
  t.setSeconds(0, 0); t.setMinutes(t.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const dayOk = domAny && dowAny ? true : domAny ? dow.has(t.getDay()) : dowAny ? dom.has(t.getDate()) : dom.has(t.getDate()) || dow.has(t.getDay());
    if (mon.has(t.getMonth() + 1) && dayOk && hour.has(t.getHours()) && min.has(t.getMinutes())) return t;
    t.setMinutes(t.getMinutes() + 1);
  }
  throw new Error(`"${expr}" never matches within a year.`);
}

/** @param {{every?: number, cron?: string}} when */
function next(when, from = new Date()) {
  if (when.cron) return nextCron(when.cron, from);
  const mins = Number(when.every);
  if (!Number.isFinite(mins) || mins < 1) throw new Error('every is a number of minutes, at least 1.');
  return new Date(from.getTime() + mins * 60000);
}

function describe(when) {
  if (when.cron) return `cron ${when.cron}`;
  const m = Number(when.every);
  return m % 1440 === 0 ? `every ${m / 1440} day${m === 1440 ? '' : 's'}` : m % 60 === 0 ? `every ${m / 60} hour${m === 60 ? '' : 's'}` : `every ${m} minute${m === 1 ? '' : 's'}`;
}

module.exports = { next, nextCron, parseCron, describe };
