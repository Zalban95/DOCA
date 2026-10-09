'use strict';

/**
 * Who may be in a meeting, and who may take control of whose screen.
 *
 * A meeting is its people's: its organizer and the people invited (rows of meeting_people with a person id). Nobody
 * else joins — an admin included: a call between two colleagues is not the machine's, so holding host opens nothing
 * here, and a meeting someone may not join answers 404 as if absent (the transcript's rule). A meeting can be opened
 * to the whole hive (`open: 'hive'`): then anyone in the same organisation who may chat joins by its link.
 *
 * Taking control follows the same permission model as a person's devices (CONSTITUTION S2; auth/reach.js): the
 * controller's level must reach devices (`own-devices` or `anything` — a level that only creates reaches none), the
 * machine must be the sharer's own paired device, both must be of the same organisation, and the sharer consents each
 * time, twice (control.js). A level that names no reach keeps its tool policy alone, as everywhere else.
 */
const rights = require('../auth/rights');

const levelOf = role => require('../auth/levels').get(role);
const rungOf = role => { try { return require('../auth/reach').rungOf(levelOf(role)); } catch { return null; } };

/** Whether this person (dashboardClient(req).user shape) may be in the meeting. */
async function mayJoin(meeting, person, list = null) {
  if (!meeting || !person?.id) return false;
  if (!rights.can(person.role, 'chat')) return false;
  if (meeting.ownerId === person.id) return true;
  if (meeting.state === 'cancelled') return false;
  if (meeting.open === 'hive' && meeting.orgId && meeting.orgId === person.orgId) return true;
  const people = list || await require('./store').people(meeting.id);
  return people.some(p => p.personId === person.id);
}

/** Why this person may not take control of another person's device, or null when their level allows it. */
function controlRefusal(controller, sharer) {
  if (!controller?.id || !sharer?.id) return 'Only a person in the meeting can take control.';
  if (controller.id === sharer.id) return 'That is your own screen.';
  if (!controller.orgId || controller.orgId !== sharer.orgId) return 'Control stays within one organisation.';
  if (!rights.can(controller.role, 'chat')) return `${controller.name || 'They'} cannot chat, so cannot take control.`;
  if (rungOf(controller.role) === 'create')
    return `${controller.name || 'Their'} level reaches only what agents create, not devices — an admin changes a level's reach in Settings → Users.`;
  if (rungOf(sharer.role) === 'create') return 'Your level does not reach devices, so none of yours can be lent.';
  return null;
}

/** The people of this organisation a meeting can invite: names only, never an address. */
function directory(orgId) {
  const store = require('../auth/store');
  if (!orgId) return [];
  return store.membersOf(orgId).filter(m => m.status === 'active').map(m => {
    const u = store.userById(m.userId);
    return u && !u.suspendedAt ? { id: u.id, name: u.name || String(u.email || '').split('@')[0] || u.id } : null;
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

/** One person of the hive, as a meeting row needs them (their address is kept for their invite, never shown to others). */
function personRow(id, orgId) {
  const store = require('../auth/store');
  const u = store.userById(id);
  if (!u || u.suspendedAt) return null;
  if (orgId && store.membership(orgId, u.id)?.status !== 'active') return null;
  return { who: u.id, personId: u.id, email: u.email || null, name: u.name || String(u.email || '').split('@')[0] };
}

/** A person as the room and the rules see them, from an id: role and organisation included. */
function personById(id, orgId) {
  return require('../harness/turn/client').personById({ id, orgId });
}

module.exports = { mayJoin, controlRefusal, directory, personRow, personById };
