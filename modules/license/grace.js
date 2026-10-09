'use strict';

/**
 * The grace an existing install gets when licensing arrives (migration 3.0-licence-grace, migrations.js): it keeps
 * every feature for DAYS from the day it first started a release with licensing, with a banner saying by when to add
 * a licence — so nothing an install relies on stops working on the day it updates. A new install is born having had
 * that migration (migrations.stamp), so it gets none: it runs `core` until a licence is added.
 *
 * It is given once (a second run keeps the first date) and never runs past LAST_DAY, whenever the install updated:
 * deleting the file to be given another month buys nothing after that day.
 */
const files = require('./files');

const DAYS = 30;
const LAST_DAY = '2027-01-31T23:59:59Z';
const DAY = 86400000;

/** Give the grace, once. 'given' or 'kept' (an earlier one stands). */
function adopt(now = Date.now()) {
  const g = files.readJson(files.GRACE, null);
  if (g?.until) return 'kept';
  const until = Math.min(now + DAYS * DAY, Date.parse(LAST_DAY));
  files.writeJson(files.GRACE, { since: new Date(now).toISOString(), until: new Date(until).toISOString(),
    why: 'this install was set up before licensing: it keeps every feature until then' });
  return 'given';
}

/** The grace this install has, if any: {since, until, active}. */
function current(now = Date.now()) {
  const g = files.readJson(files.GRACE, null);
  if (!g?.until || !Number.isFinite(Date.parse(g.until))) return null;
  return { since: g.since || null, until: g.until, active: now < Date.parse(g.until) };
}

module.exports = { adopt, current, DAYS, LAST_DAY };
