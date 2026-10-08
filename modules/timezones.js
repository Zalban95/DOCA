'use strict';

/**
 * Whose clock a time is read on. The hub runs in its own zone (often UTC in a container), and every time it wrote
 * for a person — a reminder's "1:17 PM", a schedule's "Daily 09:00" — was the hub's, read by the person as theirs
 * (deep test B, C10: the reminder said 1:17 PM while the person's clock read 15:17).
 *
 * Each signed-in screen reports its zone with its presence heartbeat (the browser's own Intl zone); the newest one a
 * person's screens reported is their zone, kept in the store so it outlives a restart. A time typed without an
 * offset is read on that clock, and a time written for them carries the offset and the zone's name.
 */
const store = require('./store');

const DOC = 'timezones';

/** A zone Intl knows (IANA, "Europe/Rome"), else null. */
function valid(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return null; }
}

const hostZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** A screen of this person reported its zone (presence heartbeat). Written only when it changed. */
function report(userId, tz) {
  const zone = valid(tz);
  if (!userId || !zone) return null;
  const all = store.readJson(DOC, {});
  if (all[userId]?.tz !== zone) store.writeJson(DOC, { ...all, [userId]: { tz: zone, at: new Date().toISOString() } });
  return zone;
}

/** The person's zone, or null when none of their screens has said. */
function of(userId) { return (userId && valid(store.readJson(DOC, {})[userId]?.tz)) || null; }

/** Minutes east of UTC for `tz` at `date`. */
function offsetMin(date, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date).map(p => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** A wall-clock time in `tz` (given as the UTC fields of `wall`) as the real moment. */
function fromWall(wall, tz) {
  let t = wall.getTime() - offsetMin(wall, tz) * 60000;
  t = wall.getTime() - offsetMin(new Date(t), tz) * 60000;   // once more, across a change of offset
  return new Date(t);
}

/** The wall clock in `tz` at `date`, as a Date whose UTC fields are that clock. */
const toWall = (date, tz) => new Date(date.getTime() + offsetMin(date, tz) * 60000);

/** "2026-10-07T18:00" read on `tz`'s clock; a time that names its offset (Z, +02:00) is taken as it is. */
function parseLocal(text, tz) {
  const s = String(text || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m || !valid(tz)) return new Date(s);
  return fromWall(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))), tz);
}

/** ISO 8601 with the zone's offset: 2026-10-08T15:17:00+02:00. */
function iso(date, tz) {
  const off = offsetMin(date, tz);
  const w = new Date(date.getTime() + off * 60000).toISOString().slice(0, 19);
  const a = Math.abs(off);
  return `${w}${off < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** For a sentence: "Thu 8 Oct, 15:17 (Europe/Rome)". */
function human(date, tz) {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  return `${t} (${tz})`;
}

/** One line of the agent's per-step readings: the person's own clock, when a screen of theirs has said its zone. */
function line(userId, now = new Date()) {
  const tz = of(userId);
  if (!tz || tz === hostZone()) return '';
  return `the person's clock: ${human(now, tz)}, ${iso(now, tz).slice(0, 16)}${iso(now, tz).slice(19)} — say times on it; the hub's is ${hostZone()}.`;
}

module.exports = { valid, hostZone, report, of, offsetMin, fromWall, toWall, parseLocal, iso, human, line };
