'use strict';

/**
 * When the mail reader reads an account — the person's setting (the owner, 2026-10-12: "a reading routine (every N
 * minutes / at set times, via schedules) or 'on every new mail'"):
 *   off     never by itself; "Read now" still works
 *   every   every N minutes (a schedule `every`)
 *   times   at set times of the person's day ("08:00", "13:30": a cron schedule per minute-of-the-hour, on their clock)
 *   new     on every new mail — a look every 2 minutes at what changed (Gmail's history id, Graph's delta query) that
 *           costs one small request and reads nothing until a mail arrived. Real push needs Gmail's watch through a
 *           Google Cloud Pub/Sub topic, or a Graph subscription posting to a public HTTPS address; a hub on a tailnet
 *           has neither, so polling the change feed is the realistic default — said beside the choice.
 * `reader: false` leaves undecided mail as "needs you" without asking the mail reader (no model at all).
 * The schedules are ordinary ones (kind `mail-read`, Harness → Schedules) in the person's name, made and removed here.
 */
const NEW_EVERY = 2;
const bad = m => Object.assign(new Error(m), { status: 400 });
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function normalize(r = {}) {
  const mode = ['off', 'every', 'times', 'new'].includes(r.mode) ? r.mode : 'off';
  const out = { mode, reader: r.reader !== false };
  if (mode === 'every') {
    out.every = Math.round(Number(r.every));
    if (!(out.every >= 5 && out.every <= 1440)) throw bad('Every how many minutes: 5 to 1440.');
  }
  if (mode === 'times') {
    out.times = [...new Set([].concat(r.times || []).map(t => String(t).trim()).filter(Boolean))].sort();
    if (!out.times.length || out.times.length > 12) throw bad('Give one to twelve times of day, like 08:00.');
    const badOne = out.times.find(t => !TIME.test(t));
    if (badOne) throw bad(`"${badOne}" is not a time of day like 08:00.`);
  }
  return out;
}

/** The schedules' `when`s for a reading. */
function whens(r) {
  if (r.mode === 'every') return [{ every: r.every }];
  if (r.mode === 'new') return [{ every: NEW_EVERY }];
  if (r.mode !== 'times') return [];
  const byMin = new Map();
  for (const t of r.times) { const [, h, m] = TIME.exec(t); byMin.set(Number(m), [...(byMin.get(Number(m)) || []), Number(h)]); }
  return [...byMin].map(([m, hs]) => ({ cron: `${m} ${hs.sort((a, b) => a - b).join(',')} * * *` }));
}

/** Set an account's reading: its record, and its schedules made again. */
function set(person, accountId, input) {
  const accounts = require('./store');
  const rec = accounts.get(person.id, accountId);
  if (!rec) throw Object.assign(new Error('No such account.'), { status: 404 });
  const r = normalize(input);
  const schedules = require('../schedules');
  for (const s of schedules.all().filter(x => x.kind === 'mail-read' && x.account === accountId && x.by === person.id)) schedules.remove(s.id);
  for (const w of whens(r)) schedules.create({ kind: 'mail-read', account: accountId, ...(w.cron ? { cron: w.cron } : { every: w.every }) }, { person, madeBy: 'person' });
  return accounts.patch(person.id, accountId, { reading: r });
}

/** An account going: its schedules go with it. */
function forget(personId, accountId) {
  const schedules = require('../schedules');
  for (const s of schedules.all().filter(x => x.kind === 'mail-read' && x.account === accountId && x.by === personId)) schedules.remove(s.id);
}

module.exports = { normalize, whens, set, forget, NEW_EVERY };
