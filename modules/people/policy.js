'use strict';

/**
 * Who may talk to whom in the hive chat — the same permission type as the rest (asked 2026-10-09): a level says it.
 *
 * A level's `people` field (auth/levels.js keeps it through this module's `levelField`):
 *   org    anyone active in the same organisation (the default for a level that holds `chat`)
 *   team   only their team (org.teamOf: their manager, the manager's other reports, everyone below them)
 *   added  only the conversations someone else added them to; they start none (a guest; the default without `chat`)
 * Sending at all needs the `chat` right (the gate): a viewer reads the spaces they were added to and writes nothing.
 * Channels: an organisation's are made by people holding `users`; a team's by its leader (`delegate`, for the people
 * below them) or `users`. Nobody reads a conversation they are not a member of — an admin included: a direct message
 * is its two people's. The owner's compliance export (export.js) is the one exception, asked for with the password and
 * written in the audit.
 */
const REACH = ['org', 'team', 'added'];
const bad = (m, status = 403) => Object.assign(new Error(m), { status });
const levels = () => require('../auth/levels');
const org = () => require('../org');

/** The value a level keeps, or null for none (then the default by its rights). Never wider than its maker's own. */
function levelField(value, actorLevel) {
  if (value === undefined || value === null || value === '') return null;
  if (!REACH.includes(value)) throw Object.assign(new Error(`Who its people may message is one of ${REACH.join(', ')}.`), { status: 400 });
  const mine = reachOf(typeof actorLevel === 'string' ? actorLevel : actorLevel?.id);
  if (REACH.indexOf(value) < REACH.indexOf(mine)) throw bad(`You cannot let a level message further than you do (${mine}).`);
  return value;
}

function reachOf(role) {
  const l = levels().get(role);
  if (!l) return 'added';
  if (REACH.includes(l.people)) return l.people;
  return l.rights.includes('chat') ? 'org' : 'added';
}

const rights = p => levels().rightsOf(p?.role);
const orgOf = p => p?.orgId || require('../auth/store').defaultOrg()?.id || null;

/** Whether `from` may start a conversation with `to` (both people records with id and role). */
function mayStart(from, toId) {
  if (!rights(from).includes('chat')) return 'Your level reads the hive chat but does not write in it.';
  const reach = reachOf(from.role);
  if (reach === 'added') return 'Your level takes part only in conversations others add you to.';
  const colleagues = org().people(orgOf(from));
  if (!colleagues.some(p => p.id === toId)) return 'That person is not an active member of your organisation.';
  if (reach === 'team' && !org().teamOf(orgOf(from), from.id).has(toId)) return 'Your level messages only your own team (your manager, your peers and your reports).';
  return null;
}

/** May `p` make a channel for `audience` ('org' or 'team:<leaderId>')? */
function mayMakeChannel(p, audience) {
  const r = rights(p);
  if (!r.includes('chat')) return 'Your level does not write in the hive chat.';
  if (r.includes('users')) return null;
  if (audience === `team:${p.id}` && r.includes('delegate')) return null;
  return audience === 'org' ? 'A channel for everyone is made by an admin.' : 'A team leader makes a channel for their own team; an admin for any.';
}

/** The channel audiences `p` is part of: their organisation, and every team (leader) above them or theirs. */
function audiencesOf(p) {
  const id = orgOf(p);
  if (!id) return [];
  const all = org().people(id), map = new Map(all.map(x => [x.id, x]));
  const out = ['org', `team:${p.id}`];
  for (let q = map.get(map.get(p.id)?.managerId), i = 0; q && i < 12; q = map.get(q.managerId), i++) out.push(`team:${q.id}`);
  return out;
}

/** Who a channel of this audience is for (people ids). */
function audienceMembers(p, audience) {
  const id = orgOf(p), all = org().people(id);
  if (audience === 'org') return all.map(x => x.id);
  const lead = String(audience || '').replace(/^team:/, '');
  return [lead, ...org().below(id, lead, all)];
}

module.exports = { REACH, levelField, reachOf, mayStart, mayMakeChannel, audiencesOf, audienceMembers, rights, orgOf };
