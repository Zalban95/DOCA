'use strict';

/**
 * May this person's agents act on this computer (security review 2026-10-07; CONSTITUTION S13, S2)? A computer holds
 * what was done in it — files, a browser profile with its sign-ins — so acting on it (start, stop, remove, copying files
 * in or out, looking at its screen, signing in on it, previewing its page, lending it to a mission) is for:
 *   - someone holding host (the machine's administrators), or
 *   - a person it is allotted to (allot.uses 'computer') who made it (its `by` is their conversation) or whose
 *     mission it is lent to.
 * Its own MCP tools pass the same allotment in permits.tool, and a turn holds only its own computers' tools
 * (turn/prompt.js othersComputers). No person on the turn (a test, the panel's host routes) is not narrowed.
 */
const isHost = person => require('../auth/rights').can(person?.role, 'host');

/** null when the person may act on computer `id`, else the sentence refusing it. Throws a 404 for an unknown one. */
function refuse(person, id) {
  if (!person?.id) return null;   // not narrowed: whatever acts next says whether the computer exists
  const c = require('./index').need(id);
  const allot = require('../auth/allot');
  if (!allot.uses(person, 'computer', c.id)) return allot.refusal(person, 'computer', c.id);
  if (isHost(person)) return null;
  const access = require('../harness/session-access');
  if (c.by && access.ownerOf(c.by) === person.id) return null;
  if (c.keptFor === person.id) return null;   // a specialist's computer kept for this person (computers.ownFor)
  // Lent to their mission — but a kept computer only when it is kept for them: an admin's specialist desktop holds the
  // admin's sign-ins, and lending it once must not open it to everyone the type works for.
  const m = c.missionId && !c.agentType ? require('../agents/missions').get(c.missionId) : null;
  if (m && (access.ownerOf(m.sessionId) === person.id || (m.by && access.ownerOf(m.by) === person.id))) return null;
  return `Computer ${c.id} "${c.name}" is not ${person.name || 'this person'}'s: an agent acts only on a computer its person made, `
    + 'or one lent to their mission (an admin\'s are an admin\'s). Make one with the computer tool.';
}

/** Throws a 403 with that sentence. */
function check(person, id) {
  const why = refuse(person, id);
  if (why) throw Object.assign(new Error(why), { status: 403 });
}

/**
 * The computers a conversation works in, the rule turn/prompt.js othersComputers holds its tools by: a specialist the
 * one its mission was lent, a work chat the ones it made, the Orchestrator none — it hands the work on.
 */
function ofConversation(sessionId) {
  if (!sessionId) return [];
  let s;
  try { s = require('../harness/organization').session(sessionId); } catch { return []; }
  if (s.kind === 'specialist') return s.profile?.computer ? [s.profile.computer] : [];
  return s.kind === 'orchestrator' ? [] : require('./index').madeBy(sessionId);
}

module.exports = { refuse, check, ofConversation };
