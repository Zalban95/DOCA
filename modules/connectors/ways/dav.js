'use strict';

/**
 * Calendars and contacts by CalDAV and CardDAV with an app password (iCloud, Fastmail, Nextcloud, any server): the
 * agent lists calendars, reads events in a range and today's, searches contacts, and adds an event — adding is always
 * a person's decision (harness/forced-asks.js). Google's CalDAV takes OAuth only (no app passwords since 2024), so
 * Google is not offered here; its calendar connects by secret address or OAuth. The protocol is calendar/dav.js; the
 * events are read with calendar/ics.js, so a repeating event expands the same way as a calendar by address.
 */
const crypto = require('crypto');
const dav = require('../../calendar/dav');
const ics = require('../../calendar/ics');
const text = require('./calendar-text');
const presets = require('../presets');

const SECRETS = ['password'];
const LOCAL = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/i;
const KEEP_MS = 10 * 60000;
const _found = new Map();   // id → { at, key, calendars, books }
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function address(v, what) {
  const s = String(v || '').trim();
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { throw bad(`${what} is an https:// address.`); }
  if (/YOUR-SERVER/i.test(s)) throw bad(`Put your server's address in ${what}.`);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL.test(u.hostname))) throw bad(`${what} is an https:// address: the password is not sent in the clear.`);
  return u.toString();
}

function accept(b, prev = {}) {
  const MASK = require('../../secrets-mask').MASK;
  const base = presets.DAV[b.provider] || presets.DAV[prev.provider] || presets.DAV.other;
  const next = { provider: presets.DAV[b.provider] ? b.provider : prev.provider || 'other' };
  next.caldav = address(b.caldav !== undefined ? b.caldav : prev.caldav ?? base.caldav, 'The CalDAV address');
  next.carddav = address(b.carddav !== undefined ? b.carddav : prev.carddav ?? base.carddav, 'The CardDAV address');
  if (!next.caldav && !next.carddav) throw bad('Give the CalDAV address, the CardDAV address, or both.');
  next.user = String(b.user || prev.user || '').trim().slice(0, 200);
  if (!next.user) throw bad('Give the user name (usually the account\'s email address).');
  if (typeof b.password === 'string' && b.password && b.password !== MASK) next.password = b.password;
  else if (!prev.password) throw bad('Paste the app password.');
  return next;
}

const view = rec => ({ configured: !!rec.password, provider: rec.provider || 'other', user: rec.user || null, caldav: rec.caldav || null, carddav: rec.carddav || null,
  hasPassword: !!rec.password, calendars: rec.calendars || null, books: rec.books || null });

const clientOf = (rec, kind) => dav.client({ base: kind === 'caldav' ? rec.caldav : rec.carddav, user: rec.user, password: rec.password });

/** The calendars and address books, found once and kept ten minutes. */
async function found(id, rec, { fresh = false } = {}) {
  const key = `${rec.caldav}|${rec.carddav}|${rec.user}`;
  const c = _found.get(id);
  if (!fresh && c && c.key === key && Date.now() - c.at < KEEP_MS) return c;
  const out = { at: Date.now(), key, calendars: [], books: [] };
  if (rec.caldav) out.calendars = await clientOf(rec, 'caldav').collections('caldav');
  if (rec.carddav) out.books = await clientOf(rec, 'carddav').collections('carddav');
  _found.set(id, out);
  return out;
}

async function test(rec, id) {
  const f = await found(id, rec, { fresh: true });
  return { summary: `${f.calendars.length} calendar${f.calendars.length === 1 ? '' : 's'}${rec.carddav ? `, ${f.books.length} address book${f.books.length === 1 ? '' : 's'}` : ''}`,
    keep: { calendars: f.calendars.length, books: f.books.length } };
}

function def(id, rec, label) {
  return { name: `connector_${id}`, description: `Read calendars and contacts in ${label} (${rec.user}), connected by CalDAV/CardDAV with an app password: `
    + 'list calendars, today\'s plan or events in a range, search contacts, or add an event — adding is always asked of a person first.',
  parameters: { type: 'object', properties: {
    action: { type: 'string', enum: ['calendars', 'today', 'events', 'contacts', 'create_event'], description: 'today (default), events in a range, calendars, contacts, or create_event.' },
    calendar: { type: 'string', description: 'A calendar\'s name from calendars; default every calendar (create_event: the first).' },
    from: { type: 'string', description: 'events: the first day (2026-10-08) or time; create_event: the start.' },
    to: { type: 'string', description: 'events: the end (not included); create_event: the end.' },
    days: { type: 'number', description: 'events: how many days from from, instead of to.' },
    query: { type: 'string', description: 'events: words in the title, place or notes; contacts: words in a name, address or number.' },
    title: { type: 'string', description: 'create_event: what it is.' },
    all_day: { type: 'boolean', description: 'create_event: a whole day (from and to as dates; to is the day after).' },
    where: { type: 'string', description: 'create_event: the place.' },
    notes: { type: 'string', description: 'create_event: notes.' },
  } } };
}

const pickCalendars = (f, name) => {
  if (!name) return f.calendars;
  const hit = f.calendars.filter(c => c.name.toLowerCase() === String(name).toLowerCase());
  if (!hit.length) throw bad(`No calendar "${name}": ${f.calendars.map(c => c.name).join(', ') || 'none'}.`, 404);
  return hit;
};

function vcards(texts) {
  return texts.map(t => {
    const card = ics.tree(t).children.find(c => c.type === 'VCARD');
    if (!card) return null;
    const all = n => card.props.filter(p => p.name === n || p.name.endsWith(`.${n}`)).map(p => p.value.replace(/\\([,;\\])/g, '$1').trim()).filter(Boolean);
    return { name: all('FN')[0] || all('N')[0]?.split(';').filter(Boolean).reverse().join(' ') || '(no name)', emails: all('EMAIL'), phones: all('TEL'), org: all('ORG')[0]?.replace(/;+$/, '') || '' };
  }).filter(Boolean);
}

const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1').replace(/\r/g, '');
const fold = line => line.replace(/(.{73})(?=.)/g, '$1\r\n ');

async function run(id, rec, args = {}, label = id) {
  const action = args.action || 'today';
  const f = await found(id, rec);
  if (action === 'calendars') return `${label}: ${f.calendars.length ? f.calendars.map(c => c.name).join(', ') : 'no calendars'}${rec.carddav ? `; ${f.books.length} address book(s)` : ''}.`;
  if (action === 'today' || action === 'events') {
    if (!rec.caldav) throw bad('This connection has no CalDAV address.');
    const { from, to } = text.range({ ...args, action });
    const out = [];
    for (const c of pickCalendars(f, args.calendar)) for (const t of await clientOf(rec, 'caldav').events(c.href, from, to)) out.push(...ics.events(t, from, to));
    out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    return text.lines(out, { query: args.query, label, from, to });
  }
  if (action === 'contacts') {
    if (!rec.carddav) throw bad('This connection has no CardDAV address.');
    const q = String(args.query || '').trim().toLowerCase();
    const people = [];
    for (const b of f.books) people.push(...vcards(await clientOf(rec, 'carddav').cards(b.href)));
    const hits = (q ? people.filter(p => `${p.name} ${p.emails.join(' ')} ${p.phones.join(' ')} ${p.org}`.toLowerCase().includes(q)) : people).slice(0, 50);
    return [`${hits.length} contact${hits.length === 1 ? '' : 's'}${q ? ` matching "${q}"` : ''} (of ${people.length}):`,
      ...hits.map(p => `- ${p.name}${p.org ? ` (${p.org})` : ''}${p.emails.length ? ` · ${p.emails.join(', ')}` : ''}${p.phones.length ? ` · ${p.phones.join(', ')}` : ''}`)].join('\n');
  }
  if (action === 'create_event') {
    if (!rec.caldav) throw bad('This connection has no CalDAV address.');
    const cal = pickCalendars(f, args.calendar)[0];
    if (!cal) throw bad('There is no calendar to add it to.');
    if (!String(args.title || '').trim()) throw bad('Give the event a title.');
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const when = (v, what) => {
      if (args.all_day) { if (!day.test(String(v || ''))) throw bad(`${what} is a date (2026-10-08) for an all-day event.`); return `;VALUE=DATE:${String(v).replace(/-/g, '')}`; }
      const t = Date.parse(String(v || ''));
      if (Number.isNaN(t)) throw bad(`${what} is a time, like 2026-10-08T15:00 (this host's time) or with its zone.`);
      return `:${new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
    };
    const start = when(args.from, 'from');
    const end = args.to ? when(args.to, 'to') : null;
    const uid = `${crypto.randomUUID()}@doca`;
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DOCA//Connectors//EN', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
      `DTSTART${start}`, ...(end ? [`DTEND${end}`] : []), fold(`SUMMARY:${esc(args.title).slice(0, 300)}`), ...(args.where ? [fold(`LOCATION:${esc(args.where).slice(0, 300)}`)] : []),
      ...(args.notes ? [fold(`DESCRIPTION:${esc(args.notes).slice(0, 4000)}`)] : []), 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
    await clientOf(rec, 'caldav').put(cal.href, `${uid.split('@')[0]}.ics`, body);
    return `Added "${String(args.title).trim()}" to ${cal.name} in ${label}.`;
  }
  throw bad(`No action "${action}": calendars, today, events, contacts or create_event.`);
}

/** Events in [from, to) for the ambient screen. */
async function events(id, rec, from, to) {
  if (!rec.caldav) return [];
  const f = await found(id, rec);
  const out = [];
  for (const c of f.calendars) for (const t of await clientOf(rec, 'caldav').events(c.href, from, to)) out.push(...ics.events(t, from, to));
  return out;
}

const forget = id => _found.delete(id);

module.exports = { via: 'dav', label: 'Calendars and contacts (CalDAV/CardDAV)', SECRETS, accept, view, test, def, run, events, forget };
