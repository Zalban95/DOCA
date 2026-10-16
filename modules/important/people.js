'use strict';

/**
 * Who may do what, in words: accounts, levels and grants changed through their routes (auth/users-routes.js), each
 * said with what it was before and what it is now — read from the records (auth/store.js, auth/levels.js,
 * auth/grants.js) before the handler runs and after it answered. Names from the records; never a password.
 */
const words = require('./words');

const store = () => require('../auth/store');
const nameOf = id => { const u = store().userById(id); return u ? (u.name || u.email || id) : id; };
const orgOf = req => req.auth?.orgId || store().defaultOrg()?.id;
const roleOf = (req, id) => store().membersOf(orgOf(req)).find(m => m.userId === id)?.role || null;

/** What to read before the handler runs, for a request this file says; null for one it does not. */
function before(req) {
  const p = req.path;
  let m;
  if ((m = /^\/api\/auth\/users\/([^/]+)$/.exec(p))) {
    const u = store().userById(m[1]);
    return { kind: 'user', id: m[1], role: roleOf(req, m[1]), name: u?.name || '', suspended: !!u?.suspendedAt };
  }
  if ((m = /^\/api\/auth\/levels\/([^/]+)$/.exec(p))) return { kind: 'level', id: m[1], level: require('../auth/levels').get(m[1]) };
  if ((m = /^\/api\/auth\/grants\/([^/]+)$/.exec(p))) return { kind: 'grant', grant: require('../auth/grants').get(m[1]) };
  if (/^\/api\/auth\/(users|levels|grants)$/.test(p)) return { kind: 'made' };
  return null;
}

const grantText = g => `${g.permission} to ${g.subject?.kind === 'user' ? nameOf(g.subject.id) : `${g.subject?.kind} ${g.subject?.id}`}`;

/** The lines a finished request says, from what was read before and what its answer and the records say now. */
function lines(req, b, answer) {
  if (!b) return null;
  const p = req.path;
  if (b.kind === 'made') {
    if (/users$/.test(p) && answer?.user) return [`Account made: ${answer.user.email || answer.user.name}, as ${answer.user.level || answer.user.role || req.body?.level || 'member'}`];
    if (/levels$/.test(p) && answer?.level) return [`Level made: ${answer.level.name || answer.level.id} (rights ${words.show(answer.level.rights)}; reach ${words.show(answer.level.reach)})`];
    if (/grants$/.test(p) && answer?.grant) return [`Grant given: ${grantText(answer.grant)}${answer.grant.scope && answer.grant.scope !== 'permanent' ? ` (${answer.grant.scope})` : ''}`];
    return null;
  }
  if (b.kind === 'grant') return b.grant ? [`Grant revoked: ${grantText(b.grant)}`] : null;
  if (b.kind === 'level') {
    const label = `Level ${b.level?.name || b.id}`;
    if (req.method === 'DELETE') return [`${label}: removed`];
    const now = require('../auth/levels').get(b.id);
    const out = words.leaves('', b.level || {}, now || {}).filter(c => c.path !== '.builtin')
      .map(c => `${label} ${c.path.slice(1)}: ${words.show(c.from)} → ${words.show(c.to)}`);
    return out.length ? out : null;
  }
  if (b.kind === 'user') {
    const who = `Account ${nameOf(b.id)}`, u = store().userById(b.id), out = [];
    const role = roleOf(req, b.id);
    if (role !== b.role) out.push(`${who}: level ${b.role || 'none'} → ${role || 'none'}`);
    if (!!u?.suspendedAt !== b.suspended) out.push(`${who}: ${u?.suspendedAt ? 'suspended' : 'restored'}`);
    if ((u?.name || '') !== b.name) out.push(`${who}: name ${b.name || 'not set'} → ${u?.name || 'not set'}`);
    return out.length ? out : null;
  }
  return null;
}

module.exports = { before, lines };
