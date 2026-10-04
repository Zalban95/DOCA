'use strict';

/**
 * Whose conversation is this, and may this person use it (auth phase 2,
 * found by the live test 2026-10-04: a member saw every conversation, could
 * write into the owner's Orchestrator, and creating a chat moved the owner's
 * "active" one — so the owner's next message from a phone, which goes to the
 * active conversation, landed in the member's).
 *
 *   - A conversation belongs to the nearest person marked on it or above it
 *     (the `person` a person's turn leaves, turn/client.js withPerson).
 *   - Anyone holding host may use every conversation: host is the machine,
 *     and the conversations are files on it.
 *   - Anyone else uses only their own; the rest are not listed and answer 404,
 *     the same as one that does not exist.
 *   - The "active" pointer — where a turn with no conversation named goes — is
 *     the host's. Someone else's turn with none named goes to their newest own
 *     conversation, or a new one.
 */
const memory = require('./memory');

const isHost = person => require('../auth/rights').can(person?.role, 'host');

/** The id of the person a conversation belongs to, or null. */
function ownerOf(sessionId) {
  for (const id of [sessionId, ...require('./organization').ancestors(sessionId)]) {
    const mark = memory.getSession(id)?.person;
    if (mark?.id) return mark.id;
  }
  return null;
}

/** No person (a test, a pre-accounts call) is not narrowed. */
function mayUse(person, sessionId) {
  if (!person?.id || isHost(person)) return true;
  return ownerOf(sessionId) === person.id;
}

/** Throws a 404 for a conversation this person may not use. */
function check(person, sessionId) {
  if (!memory.getSession(sessionId) || !mayUse(person, sessionId))
    throw Object.assign(new Error('Unknown session'), { status: 404 });
}

/** The sessions this person may see. */
function visible(person, sessions) {
  return !person?.id || isHost(person) ? sessions : sessions.filter(s => mayUse(person, s.id));
}

/** Mark a conversation as this person's when it is made. */
function claim(person, sessionId) {
  if (person?.id) memory.updateSession(sessionId, { person: { id: person.id, orgId: person.orgId } });
}

/** This person's most recently used conversation, or null. */
function newestOwn(person) {
  const own = memory.listSessions().sessions.filter(s => !s.archivedAt && mayUse(person, s.id));
  return own.length ? own.reduce((a, b) => ((b.updatedAt || '') > (a.updatedAt || '') ? b : a)).id : null;
}

/** Where a turn with no conversation named goes for this person (making one if they have none). */
function defaultFor(person) {
  if (!person?.id || isHost(person)) return memory.activeSession().id;
  const found = newestOwn(person);
  if (found) return found;
  const s = require('./organization').create({ title: 'Chat' });
  claim(person, s.id);
  return s.id;
}

module.exports = { ownerOf, mayUse, check, visible, claim, newestOwn, defaultFor, isHost };
