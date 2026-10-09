'use strict';

/**
 * Meetings: people of the hive calling each other, scheduling meetings into their own calendars, and sharing their
 * screens — with control only by the sharer's consent (asked 2026-10-09; docs/design/meetings.md).
 *
 *   store.js        meetings and the people in each (SQL, schema step 15, licence code `meetings`)
 *   access.js       who may join (its people; a meeting opened to the hive) and who may take control
 *   rooms.js        who is in a room now, and the pages' messages to each other (WebRTC signalling on the live feed)
 *   control.js      take control: two consents, input through a DOCA client on the sharer's own machine, revoked at once
 *   ics.js, invite-mail.js, invite.js, calendars.js   into each person's own calendar, whichever it is
 *   remind.js       five minutes before, on their devices
 *   routes.js       /api/meetings/*, /meet/<id>; hooks.js what the hive chat and the agent call
 *
 * This file: making, changing and cancelling a meeting, and calling someone now (a meeting that is open at once and
 * rings the people in it).
 */
const store = require('./store');
const access = require('./access');
const rooms = require('./rooms');
const invite = require('./invite');
const audit = require('./audit');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const MINUTES = 30;

/** The hub's address for links: as the person opened it when that is reachable, else its best address. */
async function baseOf(req) {
  const host = String(req?.headers?.host || '');
  const proto = req?.secure || req?.socket?.encrypted ? 'https' : 'http';
  if (host && !/^(localhost|127\.|\[?::1)/.test(host)) return `${proto}://${host}`;
  if (!req) return '';
  try { const l = (await require('../network').links(req, { qr: false })).links[0]; if (l) return l.url.replace(/\/+$/, ''); } catch { /* no network module answer */ }
  return host ? `${proto}://${host}` : '';
}

/** The people asked for: ids of this hive's people, and addresses of people outside it. */
function peopleOf(owner, { people = [], emails = [] } = {}) {
  const rows = [];
  for (const id of [].concat(people || [])) {
    if (id === owner.id) continue;
    const p = access.personRow(String(id), owner.orgId);
    if (!p) throw bad(`No one with the id ${id} in this hive.`, 404);
    rows.push({ ...p, role: 'invitee' });
  }
  for (const e of [].concat(emails || [])) {
    const email = String(e || '').trim().toLowerCase();
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) throw bad(`${e} is not a mail address.`);
    const u = require('../auth/store').userByEmail(email);
    if (u && access.personRow(u.id, owner.orgId)) { if (u.id !== owner.id && !rows.some(r => r.personId === u.id)) rows.push({ ...access.personRow(u.id, owner.orgId), role: 'invitee' }); }
    else if (!rows.some(r => r.email === email)) rows.push({ who: `mail:${email}`, personId: null, email, name: email.split('@')[0], role: 'invitee' });
  }
  if (rows.length > 50) throw bad('A meeting invites at most 50 people.');
  return rows;
}

/** When, from what was asked: `start` an ISO time or a wall time on the person's clock ("2026-10-12T15:00"). */
function timesOf(owner, { start, minutes, tz: zone } = {}) {
  const z = require('../timezones').valid(zone) || require('../timezones').of(owner.id) || require('../timezones').hostZone();
  const s = require('../timezones').parseLocal(start, z);
  if (Number.isNaN(s.getTime())) throw bad('start is a date and time, e.g. 2026-10-12T15:00 (on your clock) or with its offset.');
  const mins = Math.max(5, Math.min(24 * 60, Math.round(Number(minutes) || MINUTES)));
  return { startsAt: s.toISOString(), endsAt: new Date(s.getTime() + mins * 60000).toISOString(), tz: z };
}

/**
 * A meeting. `now`: a call this minute (open at once; its people are rung, not sent a calendar invitation).
 * `proposed`: the agent's suggestion, waiting for its person's Confirm before anyone is invited.
 */
async function create(owner, input = {}, req = null) {
  if (!owner?.id) throw bad('A meeting is a person\'s: sign in.', 401);
  const title = String(input.title || '').trim().slice(0, 200) || (input.now ? `Call with ${owner.name || 'a colleague'}` : '');
  if (!title) throw bad('A meeting needs a title.');
  const now = !!input.now || !input.start;
  const times = now ? { startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + (Number(input.minutes) || MINUTES) * 60000).toISOString(), tz: require('../timezones').of(owner.id) } : timesOf(owner, input);
  const list = peopleOf(owner, input);
  const m = await store.create({ ownerId: owner.id, orgId: owner.orgId, title, ...times, state: input.proposed ? 'proposed' : now ? 'open' : 'scheduled',
    space: input.space ? String(input.space).slice(0, 120) : null, note: String(input.note || '').slice(0, 2000), open: input.open === 'hive' ? 'hive' : 'invited',
    base: input.base || await baseOf(req) });
  const me = access.personRow(owner.id, owner.orgId) || { who: owner.id, personId: owner.id, name: owner.name, email: owner.email };
  await store.putPerson(m.id, { ...me, role: 'organizer', status: 'organizer' });
  for (const p of list) await store.putPerson(m.id, { ...p, status: input.proposed ? 'proposed' : now ? 'rung' : 'pending' });
  audit.meeting(m, input.proposed ? 'proposed' : now ? 'called' : 'scheduled', owner);
  let sent = [];
  if (m.state === 'scheduled') sent = await invite.deliver(m, { actor: owner });
  if (m.state === 'open') ring(m, owner, list);
  require('./hooks').emit('created', { meeting: m, by: owner });
  return { meeting: await view(m, owner), sent };
}

/** Ring the people of a call that starts now: their open pages show it with Join, their devices are told. */
function ring(m, owner, list) {
  const ids = list.filter(p => p.personId && p.personId !== owner.id).map(p => p.personId);
  if (!ids.length) return;
  require('../live').changed('meeting', m.id, 'ring', { personIds: ids, by: owner.name, title: m.title, link: invite.link(m) });
  for (const id of ids) {
    try {
      const notice = require('../harness/reach-notice');
      notice.deliver({ personId: id, title: `${owner.name || 'Someone'} is calling`, text: `${m.title}\nJoin: ${invite.link(m)}`, to: notice.ownIds(id), urgent: true, panel: 'fallback', from: 'meetings' });
    } catch { /* ringing never breaks the call */ }
  }
}

/** A meeting as a person of it sees it: its people (names, how each was invited) and who is in the room now. */
async function view(m, person) {
  const people = await store.people(m.id);
  const mine = m.ownerId === person?.id;
  return { ...m, base: undefined, link: invite.link(m), organizer: m.ownerId === person?.id,
    people: people.map(p => ({ who: p.who, personId: p.personId, name: p.name, role: p.role, ...(mine ? { via: p.via, status: p.status, note: p.note, email: p.personId ? undefined : p.email } : {}) })),
    room: rooms.snapshot(m.id), control: require('./control').list(m.id) };
}

/** The meeting, if this person may see it — else a 404, as if it did not exist. */
async function reachable(id, person) {
  const m = await store.get(id);
  if (!m || !(await access.mayJoin(m, person))) throw bad('No such meeting.', 404);
  return m;
}

/** Change a meeting (its organizer): time, title, note, people. A calendar sees it as the same event, SEQUENCE + 1. */
async function update(id, person, input = {}) {
  const m = await reachable(id, person);
  if (m.ownerId !== person.id) throw bad('Only its organizer changes a meeting.', 403);
  if (['cancelled', 'ended'].includes(m.state)) throw bad(`This meeting is ${m.state}.`, 409);
  const fields = {};
  if (input.title !== undefined) fields.title = String(input.title).trim().slice(0, 200) || m.title;
  if (input.note !== undefined) fields.note = String(input.note).slice(0, 2000);
  if (input.start !== undefined || input.minutes !== undefined)
    Object.assign(fields, timesOf(person, { start: input.start ?? m.startsAt, minutes: input.minutes ?? (Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60000, tz: input.tz || m.tz }));
  const before = await store.people(id);
  let removed = [], added = [];
  if (input.people !== undefined || input.emails !== undefined) {
    const next = peopleOf(person, { people: input.people ?? before.filter(p => p.personId && p.role !== 'organizer').map(p => p.personId), emails: input.emails ?? before.filter(p => !p.personId).map(p => p.email) });
    removed = before.filter(p => p.role !== 'organizer' && !next.some(n => n.who === p.who));
    added = next.filter(n => !before.some(p => p.who === n.who));
    for (const p of removed) await store.dropPerson(id, p.who);
    for (const p of added) await store.putPerson(id, { ...p, status: 'pending' });
  }
  const next = await store.update(id, fields, { bump: m.state === 'scheduled' });
  audit.meeting(next, 'changed', person);
  const sent = next.state === 'scheduled' ? await invite.deliver(next, { removed, actor: person }) : [];
  return { meeting: await view(next, person), sent };
}

/** Cancel (its organizer): every calendar gets METHOD:CANCEL, the room closes. */
async function cancel(id, person) {
  const m = await reachable(id, person);
  if (m.ownerId !== person.id) throw bad('Only its organizer cancels a meeting.', 403);
  if (m.state === 'cancelled') return { meeting: await view(m, person), sent: [] };
  const was = m.state;
  const next = await store.update(id, { state: 'cancelled' }, { bump: true });
  rooms.close(id, 'the meeting was cancelled');
  audit.meeting(next, 'cancelled', person);
  const sent = was === 'scheduled' ? await invite.deliver(next, { cancel: true, actor: person }) : [];
  return { meeting: await view(next, person), sent };
}

/** The person confirms a meeting the agent proposed for them: now its people are invited. */
async function confirm(id, person, req = null) {
  const m = await reachable(id, person);
  if (m.ownerId !== person.id) throw bad('Only its organizer confirms a meeting.', 403);
  if (m.state !== 'proposed') throw bad(`This meeting is ${m.state}, not proposed.`, 409);
  // A meeting the agent proposed was made with no request to read the hub's address from: the confirming page's.
  const next = await store.update(id, { state: Date.parse(m.startsAt) <= Date.now() + 60000 ? 'open' : 'scheduled', base: m.base || await baseOf(req) });
  for (const p of await store.people(id)) if (p.role !== 'organizer') await store.patchPerson(id, p.who, { status: 'pending' });
  audit.meeting(next, 'confirmed', person);
  const sent = next.state === 'scheduled' ? await invite.deliver(next, { actor: person }) : [];
  if (next.state === 'open') ring(next, person, await store.people(id));
  return { meeting: await view(next, person), sent };
}

/** End a call for everyone (its organizer), or mark it ended when the last page left. */
async function end(id, person) {
  const m = await reachable(id, person);
  if (m.ownerId !== person.id) throw bad('Only its organizer ends a meeting for everyone; Leave leaves it.', 403);
  rooms.close(id, `${person.name} ended the meeting`);
  return { meeting: await view(await store.update(id, { state: m.state === 'cancelled' ? 'cancelled' : 'ended' }), person) };
}

module.exports = { create, update, cancel, confirm, end, view, reachable, ring, baseOf, hears: rooms.hears };
