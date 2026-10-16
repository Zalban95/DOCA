'use strict';

/**
 * Everyone has their own Orchestrator (asked 2026-10-09 for the floating chat; made the rule everywhere 2026-10-16).
 * The hub's main Orchestrator (memory.mainSession) is its owner's — the first person who wrote in it, or a host while
 * nobody has; anyone else, a host included, gets an Orchestrator of their own, a conversation of kind `orchestrator`
 * marked `ownMain` and claimed by them, made the first time they need one. Their devices, their unnamed turns, the work
 * chats and missions they start, and the wakes and reports of that work go to it — never to another person's.
 *
 *   of(person, {create})          the person's Orchestrator; null when they have none yet and `create` is false
 *   forSession(id, {create})      the Orchestrator a conversation's work reports to: its person's, else the hub's
 *   forPerson(person)             the parent a new conversation for this person gets (the hub's for nobody)
 *   isMain(id)                    whether `id` is a live Orchestrator (the hub's or a person's own)
 *   all()                         every live Orchestrator, the hub's first
 *   reset(person)                 Clear: a hub owner's resets the hub's (as before); anyone else's own is put away and
 *                                 a new one made, which takes over the conversations below the old one
 */
const memory = require('./memory');

const isHost = p => require('./session-access').isHost(p);

/** Whether the hub's main Orchestrator is this person's. */
function hubs(person) {
  const mark = memory.mainSession().person?.id || null;
  return !person?.id || mark === person.id || (!mark && isHost(person));
}

function find(person) {
  return memory.listSessions().sessions.find(s => s.ownMain && s.kind === 'orchestrator' && !s.archivedAt && s.person?.id === person.id) || null;
}

function of(person, { create = true } = {}) {
  if (hubs(person)) return memory.mainSession().id;
  const found = find(person);
  if (found || !create) return found?.id || null;
  const s = memory.createSession('Orchestrator', { activate: false, kind: 'orchestrator' });
  memory.updateSession(s.id, { ownMain: true, titleLocked: true });
  require('./session-access').claim(person, s.id);
  return s.id;
}

/** A person from a conversation's mark {id, orgId}: with their role, so a host is known; the mark alone when unreadable. */
function personOfMark(mark) {
  if (!mark?.id) return null;
  try {
    const store = require('../auth/store');
    const user = store.userById(mark.id);
    if (user) {
      const orgId = mark.orgId || store.defaultOrg()?.id || null;
      return { id: user.id, orgId, role: orgId ? store.membership(orgId, user.id)?.role || null : null };
    }
  } catch { /* no account store (a bare test): the mark is enough to find their own */ }
  return { id: mark.id, orgId: mark.orgId || null };
}

/**
 * The person a conversation is for: the first mark up its own parents. Read from the rows, not through
 * organization.ancestors(), which asks this module where a chain without an Orchestrator ends.
 */
function markOf(sessionId) {
  const seen = new Set();
  for (let row = memory.getSession(sessionId); row && !seen.has(row.id); row = row.parentId ? memory.getSession(row.parentId) : null) {
    seen.add(row.id);
    if (row.person?.id) return row.person;
  }
  return null;
}

function isMain(id) {
  const s = id && memory.getSession(id);
  return !!s && s.kind === 'orchestrator' && !s.archivedAt && (s.ownMain || id === memory.mainSession().id);
}

function forPerson(person, { create = true } = {}) {
  return (person?.id && of(person, { create })) || memory.mainSession().id;
}

function forSession(sessionId, { create = true } = {}) {
  if (isMain(sessionId)) return sessionId;
  return forPerson(personOfMark(markOf(sessionId)), { create });
}

/** Whether two Orchestrators are one person's: an earlier one put away, read from the current one. */
function sameLine(a, b) {
  const kindOf = id => memory.getSession(id)?.kind;
  if (kindOf(a) !== 'orchestrator' || kindOf(b) !== 'orchestrator') return false;
  const access = require('./session-access');
  return access.ownerOf(a) === access.ownerOf(b);
}

function all() {
  const main = memory.mainSession().id;
  return [main, ...memory.listSessions().sessions.filter(s => s.ownMain && s.kind === 'orchestrator' && !s.archivedAt && s.id !== main).map(s => s.id)];
}

function reset(person) {
  if (hubs(person)) return memory.resetMain();
  const found = find(person);
  if (found && require('./agent').isRunning(found.id)) throw Object.assign(new Error('Stop the Orchestrator before clearing chat.'), { status: 409 });
  if (found) memory.updateSession(found.id, { archivedAt: new Date().toISOString() });
  const next = of(person);
  // What the old one led now reports to the new one, as the hub's Clear does (memory.resetMain).
  if (found) for (const child of memory.listSessions().sessions) if (child.parentId === found.id) memory.updateSession(child.id, { parentId: next });
  return memory.getSession(next);
}

module.exports = { of, reset, hubs, forSession, forPerson, isMain, all, sameLine, markOf, personOfMark };
