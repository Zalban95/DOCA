'use strict';

/**
 * Everyone sees their own Orchestrator (asked 2026-10-09, with the hive chat). The hub's main Orchestrator
 * (memory.mainSession) is its owner's — the first person who wrote in it, or a host while nobody has; anyone else
 * gets an Orchestrator of their own, a conversation of kind `orchestrator` marked `ownMain` and claimed by them, made
 * the first time they write. Before this the floating chat wrote every person into the hub's one Orchestrator, and
 * its history read it back to anyone who could sign in.
 *
 *   of(person, {create})   the conversation the floating chat is for this person; null when they have none yet and
 *                          `create` is false (a read never makes one)
 *   reset(person)          Clear: a host's resets the hub's (as before); anyone else's own is put away and a new one made
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

function reset(person) {
  if (hubs(person)) return memory.resetMain();
  const found = find(person);
  if (found) memory.updateSession(found.id, { archivedAt: new Date().toISOString() });
  return memory.getSession(of(person));
}

module.exports = { of, reset, hubs };
