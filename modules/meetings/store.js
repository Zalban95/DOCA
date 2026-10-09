'use strict';

/**
 * Meetings in the database (schema step 15, licence code `meetings`): a meeting row and a row per person in it.
 *
 *   meeting  { id, ownerId, orgId, title, startsAt, endsAt, tz, state, seq, space, createdAt, updatedAt,
 *              note, open, base }                     — note, open (invited|hive) and base (the hub's address) ride in `data`
 *   state    proposed (the agent's, waiting for its person) · scheduled · open (a call now) · ended · cancelled
 *   person   { who, personId, email, name, role: organizer|invitee, via, eventId, status, note, remindedAt }
 *            `who` is the person's id, or `mail:<address>` for someone outside the hive
 *
 * `seq` is iCalendar's SEQUENCE: every change a calendar must see (time, title, people, cancelling) raises it.
 */
const crypto = require('crypto');
const db = require('../db');

const now = () => new Date().toISOString();
const T = "tenant_id = 'local'";

/** A meeting's id: short enough to read out ("call id"), long enough not to be guessed. */
const newId = () => `m${crypto.randomBytes(6).toString('hex')}`;
const ID = /^m[0-9a-f]{12}$/;

function rowOf(r) {
  if (!r) return null;
  let data = {};
  try { data = JSON.parse(r.data || '{}') || {}; } catch { /* an old row */ }
  return { id: r.id, ownerId: r.owner_id, orgId: r.org_id || null, title: r.title, startsAt: r.starts_at || null, endsAt: r.ends_at || null,
    tz: r.tz || null, state: r.state, seq: Number(r.seq) || 0, space: r.space || null, createdAt: r.created_at, updatedAt: r.updated_at,
    note: data.note || '', open: data.open || 'invited', base: data.base || null };
}

const personOf = r => ({ who: r.who, personId: r.person_id || null, email: r.email || null, name: r.name || '', role: r.role, via: r.via || null,
  eventId: r.event_id || null, status: r.status || null, note: r.note || null, remindedAt: r.reminded_at || null });

async function create(m) {
  const id = m.id || newId(), at = now();
  await db.run(`INSERT INTO meetings (tenant_id, id, owner_id, org_id, title, starts_at, ends_at, tz, state, seq, space, created_at, updated_at, data)
    VALUES ('local', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
  [id, m.ownerId, m.orgId || null, m.title, m.startsAt || null, m.endsAt || null, m.tz || null, m.state, m.space || null, at, at,
    JSON.stringify({ note: m.note || '', open: m.open || 'invited', base: m.base || null })]);
  return get(id);
}

async function get(id) {
  if (!ID.test(String(id || ''))) return null;
  return rowOf(await db.get(`SELECT * FROM meetings WHERE ${T} AND id = ?`, [id]));
}

/** Change what is given; `bump` raises SEQUENCE (a change a calendar must see). */
async function update(id, fields, { bump = false } = {}) {
  const m = await get(id);
  if (!m) return null;
  const next = { ...m, ...fields };
  await db.run(`UPDATE meetings SET title = ?, starts_at = ?, ends_at = ?, tz = ?, state = ?, seq = ?, space = ?, updated_at = ?, data = ?
    WHERE ${T} AND id = ?`, [next.title, next.startsAt, next.endsAt, next.tz, next.state, m.seq + (bump ? 1 : 0), next.space, now(),
    JSON.stringify({ note: next.note || '', open: next.open || 'invited', base: next.base || null }), id]);
  return get(id);
}

async function people(id) {
  return (await db.all(`SELECT * FROM meeting_people WHERE ${T} AND meeting_id = ? ORDER BY role DESC, name`, [id])).map(personOf);
}

async function putPerson(id, p) {
  await db.run(`INSERT INTO meeting_people (tenant_id, meeting_id, who, person_id, email, name, role, via, event_id, status, note, reminded_at)
    VALUES ('local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (tenant_id, meeting_id, who) DO UPDATE SET person_id = excluded.person_id, email = excluded.email, name = excluded.name,
      role = excluded.role, via = excluded.via, event_id = excluded.event_id, status = excluded.status, note = excluded.note, reminded_at = excluded.reminded_at`,
  [id, p.who, p.personId || null, p.email || null, p.name || '', p.role || 'invitee', p.via || null, p.eventId || null, p.status || null, p.note || null, p.remindedAt || null]);
}

async function patchPerson(id, who, fields) {
  const cur = (await people(id)).find(p => p.who === who);
  if (cur) await putPerson(id, { ...cur, ...fields });
}

async function dropPerson(id, who) { await db.run(`DELETE FROM meeting_people WHERE ${T} AND meeting_id = ? AND who = ?`, [id, who]); }

/** The meetings a person organizes or is invited to, newest start first; `since` drops the ones long over. */
async function forPerson(personId, { since = null, limit = 50 } = {}) {
  const rows = await db.all(`SELECT m.* FROM meetings m WHERE m.${T} AND (m.owner_id = ? OR EXISTS (SELECT 1 FROM meeting_people p
      WHERE p.${T} AND p.meeting_id = m.id AND p.person_id = ?)) ORDER BY COALESCE(m.starts_at, m.created_at) DESC`, [personId, personId]);
  return rows.map(rowOf).filter(m => !since || (m.endsAt || m.updatedAt) >= since).slice(0, limit);
}

/** Scheduled meetings starting between two times (the reminders). */
async function startingBetween(from, to) {
  return (await db.all(`SELECT * FROM meetings WHERE ${T} AND state = 'scheduled' AND starts_at >= ? AND starts_at <= ?`, [from, to])).map(rowOf);
}

module.exports = { create, get, update, people, putPerson, patchPerson, dropPerson, forPerson, startingBetween, newId, ID };
