'use strict';

/**
 * A calendar by its secret address (iCalendar over https): Google Calendar's "Secret address in iCal format", an
 * iCloud public calendar's link, Outlook's published ICS link, Fastmail's — read-only, with no OAuth app. The address
 * is the secret (whoever has it reads the calendar), so it lives in the vault, is never sent back, never logged, and
 * never in an error: a failure names the host at most. The calendar is fetched at most every five minutes and read
 * with calendar/ics.js; the tool lists the events in a range or today's.
 */
const ics = require('../../calendar/ics');
const text = require('./calendar-text');

const SECRETS = ['address'];
const MAX_BYTES = 10 * 1024 * 1024;
const KEEP_MS = 5 * 60000;
const _cache = new Map();   // id → { at, address, cal }
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function accept(b, prev = {}) {
  const MASK = require('../../secrets-mask').MASK;
  const next = {};
  if (typeof b.address === 'string' && b.address.trim() && b.address !== MASK) {
    const a = b.address.trim().replace(/^webcals?:\/\//i, 'https://');
    let u;
    try { u = new URL(a); } catch { throw bad('Paste the calendar\'s address as it was given (https://… or webcal://…).'); }
    if (!/^https?:$/.test(u.protocol)) throw bad('A calendar address starts with https:// or webcal://.');
    next.address = u.toString();
  } else if (!prev.address) throw bad('Paste the calendar\'s secret address.');
  return next;
}

const hostOf = a => { try { return new URL(a).host; } catch { return null; } };
const view = rec => ({ configured: !!rec.address, host: hostOf(rec.address), calendar: rec.calendar || null });

/** The calendar, read (kept five minutes). Errors say what went wrong without the address. */
async function load(id, rec, { fresh = false } = {}) {
  const c = _cache.get(id);
  if (!fresh && c && c.address === rec.address && Date.now() - c.at < KEEP_MS) return c.cal;
  let r;
  try { r = await fetch(rec.address, { signal: AbortSignal.timeout(20000), headers: { Accept: 'text/calendar, */*', 'User-Agent': 'DOCA' } }); }
  catch (e) { throw bad(`${hostOf(rec.address)} could not be reached (${e.cause?.code || e.name}).`, 502); }
  if (!r.ok) throw bad(`${hostOf(rec.address)} answered ${r.status}${r.status === 404 || r.status === 401 || r.status === 403 ? ': the address may have been reset or unpublished — paste the current one' : ''}.`, 502);
  const len = Number(r.headers.get('content-length')) || 0;
  if (len > MAX_BYTES) throw bad(`The calendar is larger than ${MAX_BYTES / 1048576} MB.`, 502);
  const body = await r.text();
  if (body.length > MAX_BYTES) throw bad(`The calendar is larger than ${MAX_BYTES / 1048576} MB.`, 502);
  if (!/BEGIN:VCALENDAR/i.test(body)) throw bad(`What ${hostOf(rec.address)} sent is not a calendar (no BEGIN:VCALENDAR) — is it the iCal/ICS address, not the page's?`, 502);
  const cal = ics.parse(body);
  _cache.set(id, { at: Date.now(), address: rec.address, cal });
  return cal;
}

async function test(rec, id) {
  const cal = await load(id, rec, { fresh: true });
  return { summary: `${cal.name ? `"${cal.name}", ` : ''}${cal.events.length} event${cal.events.length === 1 ? '' : 's'} read`, keep: { calendar: cal.name || null } };
}

function def(id, rec, label) {
  return { name: `connector_${id}`, description: `Read ${label}${rec.calendar ? ` ("${rec.calendar}")` : ''} — a calendar connected by its secret address, read-only: `
    + 'today\'s plan, or the events in a range (repeating events expanded), with what, when and where.',
  parameters: { type: 'object', properties: {
    action: { type: 'string', enum: ['today', 'events'], description: 'today (default): today\'s events; events: those in a range.' },
    from: { type: 'string', description: 'events: the first day (2026-10-08) or time; default today.' },
    to: { type: 'string', description: 'events: the end (not included); default a week after from.' },
    days: { type: 'number', description: 'Instead of to: how many days from from (today: 1, 2 for today and tomorrow).' },
    query: { type: 'string', description: 'Only events whose title, place or notes hold these words.' },
  } } };
}

async function run(id, rec, args = {}, label = id) {
  const action = args.action === 'events' ? 'events' : 'today';
  const { from, to } = text.range({ ...args, action });
  const cal = await load(id, rec);
  return text.lines(ics.events(cal, from, to), { query: args.query, label: `${label}${cal.name ? ` ("${cal.name}")` : ''}`, from, to });
}

/** Events in [from, to) for the ambient screen, as { title, start, end, allDay, where }. */
async function events(id, rec, from, to) {
  return ics.events(await load(id, rec), from, to, { max: 50 });
}

const forget = id => _cache.delete(id);

module.exports = { via: 'ics', label: 'Calendar by secret address', SECRETS, accept, view, test, def, run, events, forget };
