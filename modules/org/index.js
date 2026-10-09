'use strict';

/**
 * The organisation tree (asked 2026-10-09: "an organisation tree in the info of the user"): who reports to whom, which
 * team a person is in, and their title — three fields on the person's own account record (`managerId`, `team`,
 * `title`; auth/store's `data` holds the whole record, so a field needs no schema step in either accounts backend).
 *
 *   people(orgId)          the active people of an organisation, as colleagues see them (never an email to a viewer)
 *   tree(orgId)            the same as a tree: whoever has no manager here is a root
 *   card(viewer, id)       one person's card: level, team path, manager, reports, devices online, local time
 *   below(orgId, id)       everyone under a person, at any depth
 *   teamOf(orgId, id)      the people a person works with: their manager, the manager's other reports, their own reports
 *   setPlace(actor, id, …) change someone's manager, team or title: anyone holding `users`, or a team leader (`delegate`)
 *                          for the people below them and only to a manager inside their own branch
 * Core, like the accounts it reads: a hive without the hive chat still has its tree (people/ uses it).
 */
const store = () => require('../auth/store');
const levels = () => require('../auth/levels');
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

function people(orgId) {
  if (!orgId) return [];
  return store().membersOf(orgId).filter(m => m.status === 'active').map(m => {
    const u = store().userById(m.userId);
    if (!u || u.suspendedAt) return null;
    return { id: u.id, name: u.name || u.email.split('@')[0], email: u.email, level: m.role, levelName: levels().get(m.role)?.name || m.role,
      managerId: u.managerId || null, team: u.team || '', title: u.title || '' };
  }).filter(Boolean);
}

const byId = list => new Map(list.map(p => [p.id, p]));

function tree(orgId) {
  const all = people(orgId), map = byId(all);
  const node = p => ({ ...p, reports: all.filter(c => c.managerId === p.id).map(node) });
  return all.filter(p => !p.managerId || !map.has(p.managerId)).map(node);
}

function below(orgId, id, all = people(orgId)) {
  const out = new Set();
  const walk = m => { for (const p of all) if (p.managerId === m && !out.has(p.id) && p.id !== id) { out.add(p.id); walk(p.id); } };
  walk(id);
  return out;
}

function teamOf(orgId, id) {
  const all = people(orgId), me = all.find(p => p.id === id);
  if (!me) return new Set();
  const out = below(orgId, id, all);
  if (me.managerId) { out.add(me.managerId); for (const p of all) if (p.managerId === me.managerId) out.add(p.id); }
  out.delete(id);
  return out;
}

/** Org name › manager's team chain › their own team: where someone sits, in words. */
function path(orgId, id, all = people(orgId)) {
  const map = byId(all), chain = [];
  for (let p = map.get(id), i = 0; p && i < 12; p = map.get(p.managerId), i++) if (p.team && chain[0] !== p.team) chain.unshift(p.team);
  return [store().defaultOrg()?.id === orgId ? store().defaultOrg()?.name : null, ...chain].filter(Boolean);
}

function card(viewer, id) {
  const orgId = viewer?.orgId || store().defaultOrg()?.id;
  const all = people(orgId), map = byId(all), p = map.get(id);
  if (!p) throw bad('No such person here.', 404);
  const host = require('../harness/session-access').isHost(viewer);
  const devs = require('../api-v1/devices').list().filter(d => d.userId === id && !d.revokedAt && d.kind !== 'browser');
  const bus = require('../api-v1/bus');
  const tz = require('../timezones').of(id);
  const lite = q => q && { id: q.id, name: q.name, title: q.title, team: q.team };
  return {
    ...p, email: viewer?.id === id || require('../auth/rights').can(viewer?.role, 'users') || host ? p.email : undefined,
    path: path(orgId, id, all), manager: lite(map.get(p.managerId)) || null,
    reports: all.filter(q => q.managerId === id).map(lite),
    devices: { paired: devs.length, online: devs.filter(d => bus.isOnline(d.id)).length },
    atPanel: require('../presence').state(Date.now(), id).atPanel,
    timeZone: tz, localTime: tz ? require('../timezones').human(new Date(), tz) : null,
    editable: mayPlace(viewer, id, all) === null,
  };
}

/** Why `actor` may not change where `id` sits, or null when they may. */
function mayPlace(actor, id, all) {
  if (!actor?.id) return 'Sign in first.';
  const rights = levels().rightsOf(actor.role);
  if (rights.includes('users')) return null;
  if (!rights.includes('delegate')) return 'Changing the organisation tree is an admin\'s, or a team leader\'s for their own people.';
  const orgId = actor.orgId || store().defaultOrg()?.id;
  if (!below(orgId, actor.id, all || people(orgId)).has(id)) return 'A team leader places only the people below them.';
  return null;
}

function setPlace(actor, id, { managerId, team, title } = {}) {
  const orgId = actor?.orgId || store().defaultOrg()?.id;
  const all = people(orgId), map = byId(all);
  if (!map.has(id)) throw bad('No such person here.', 404);
  const why = mayPlace(actor, id, all);
  if (why) throw bad(why, 403);
  const patch = {};
  if (managerId !== undefined) {
    const m = managerId || null;
    if (m && !map.has(m)) throw bad('That manager is not an active person here.', 400);
    if (m === id) throw bad('Nobody reports to themselves.', 400);
    if (m && below(orgId, id, all).has(m)) throw bad(`${map.get(m).name} reports to ${map.get(id).name} already: that would be a circle.`, 400);
    if (m && !levels().rightsOf(actor.role).includes('users') && m !== actor.id && !below(orgId, actor.id, all).has(m))
      throw bad('A team leader places people only under themselves or someone below them.', 403);
    patch.managerId = m;
  }
  if (team !== undefined) patch.team = String(team || '').trim().slice(0, 60);
  if (title !== undefined) patch.title = String(title || '').trim().slice(0, 80);
  store().updateUser(id, patch);
  store().audit({ orgId, actorId: actor.id, subjectId: id, action: 'org place changed', detail: JSON.stringify(patch) });
  try { require('../live').changed('org', id, 'changed', { orgId }); } catch { /* a screen never breaks the work */ }
  return card(actor, id);
}

module.exports = { people, tree, below, teamOf, path, card, setPlace, mayPlace };
