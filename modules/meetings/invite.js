'use strict';

/**
 * A meeting, into each person's own calendar — whichever it is (asked 2026-10-09). For every person in it:
 *
 *   1. their own calendar is connected here (calendars.js) → the event is made, changed or removed there, as theirs
 *   2. else the hub can send mail and has their address → a standard iCalendar invitation (REQUEST or CANCEL, its UID
 *      and SEQUENCE: invite-mail.js), which Google, Outlook and Apple calendars take as they are
 *   3. else they are in the hive → a notice with the link, and "add to calendar" (the same .ics, from the hub)
 *
 * A person of the hive also gets a notice on their pages either way ("X invited you to …", in their own time zone);
 * the reminder five minutes before reaches their devices too (remind.js). Each row records how it went (`via`,
 * `status`, the calendar's `eventId` for later changes), and the organizer's page shows it.
 */
const store = require('./store');
const tz = require('../timezones');

const link = m => `${String(m.base || '').replace(/\/+$/, '')}/meet/${m.id}`;
const icsLink = m => `${String(m.base || '').replace(/\/+$/, '')}/api/meetings/${m.id}/invite.ics`;

/** "Thu 8 Oct, 15:00 (Europe/Rome)" on this person's clock (their screens said their zone), else the meeting's. */
function when(m, personId) {
  if (!m.startsAt) return 'now';
  const zone = tz.of(personId) || m.tz || tz.hostZone();
  return tz.human(new Date(m.startsAt), zone);
}

function words(m, p, organizer, cancel) {
  const head = cancel ? `${organizer.name} cancelled "${m.title}" (${when(m, p.personId)}).`
    : `${organizer.name} invites you to "${m.title}" — ${when(m, p.personId)}, ${Math.round((Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60000)} minutes.`;
  return cancel ? head : [head, m.note, `Join: ${link(m)}`, `Meeting id: ${m.id}`, `Add to your calendar: ${icsLink(m)}`].filter(Boolean).join('\n\n');
}

/** The calendar file for one meeting, as any of its people downloads it. */
async function icsFor(m, method = 'REQUEST') {
  const people = await store.people(m.id);
  const organizer = people.find(p => p.role === 'organizer') || { name: require('../branding').name('product') };
  return require('./ics').forMeeting(m, { method, url: link(m), organizer: { name: organizer.name, email: organizer.email },
    attendees: people.filter(p => p.role !== 'organizer').map(p => ({ name: p.name, email: p.email })) });
}

async function one(m, p, organizer, { cancel, actorId }) {
  const result = { via: null, status: null, note: null, eventId: p.eventId };
  // 1. Their own calendar, connected here.
  if (p.personId && require('./calendars').get(p.personId)) {
    try {
      const r = await require('./calendars').sync(p.personId, m, link(m), { eventId: p.eventId, cancel });
      return { ...result, via: r.provider, eventId: r.eventId, status: cancel ? 'cancelled' : 'in their calendar' };
    } catch (e) { result.note = `their calendar refused (${e.message}); `; }
  }
  if (p.role === 'organizer' && p.personId === actorId) return { ...result, status: cancel ? 'cancelled' : 'organizer' };
  // 2. An iCalendar invitation by mail.
  const mail = require('./invite-mail');
  if (p.email && mail.ready()) {
    try {
      await mail.send({ to: p.email, subject: `${cancel ? 'Cancelled' : 'Invitation'}: ${m.title}`, text: words(m, p, organizer, cancel),
        ics: await icsFor(m, cancel ? 'CANCEL' : 'REQUEST'), method: cancel ? 'CANCEL' : 'REQUEST' });
      return { ...result, via: 'mail', status: cancel ? 'cancelled' : 'invited by mail' };
    } catch (e) { result.note = `${result.note || ''}the mail was not sent (${e.message}); `; }
  }
  // 3. A notice, when they are in the hive (below, for everyone of the hive).
  if (p.personId) return { ...result, via: result.via || 'notice', status: cancel ? 'cancelled' : 'told on their pages' };
  return { ...result, status: 'not reached', note: `${result.note || ''}nobody can reach ${p.email || 'them'}: set up mail in Settings → Channels → Mail` };
}

/**
 * Send the meeting to its people: an invitation (or update) or a cancellation. `only`: these rows' `who` alone (a
 * person added later); `removed`: rows taken out of it, who are sent a cancellation.
 */
async function deliver(m, { cancel = false, only = null, removed = [], actor = null } = {}) {
  const people = await store.people(m.id);
  const organizer = people.find(p => p.role === 'organizer') || { name: actor?.name || 'Someone' };
  const out = [];
  for (const p of [...people.filter(x => !only || only.includes(x.who)).map(x => [x, cancel]), ...removed.map(x => [x, true])]) {
    const [row, off] = p;
    const r = await one(m, row, organizer, { cancel: off, actorId: actor?.id });
    if (!removed.includes(row)) await store.patchPerson(m.id, row.who, { via: r.via, eventId: r.eventId, status: r.status, note: r.note });
    if (row.personId && row.personId !== actor?.id) {
      try { require('../notices').post({ personId: row.personId, title: off ? `Cancelled: ${m.title}` : `Meeting: ${m.title}`, text: words(m, row, organizer, off), from: 'meetings' }); }
      catch { /* a notice never breaks the invitation */ }
    }
    out.push({ who: row.who, name: row.name, ...r });
  }
  return out;
}

module.exports = { deliver, icsFor, link, icsLink, when, words };
