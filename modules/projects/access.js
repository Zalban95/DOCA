'use strict';

/**
 * Whose project is this, and what may this person do with it (owner, 2026-10-16: "every project has an owner; people
 * have their own projects and can share them — who may see it and who may work on it"). The rules, one place:
 *
 *   - A project belongs to whoever made it (`owner: {id, orgId}`). One made before projects had owners has none and is
 *     the hub's: only a host sees it (the read-side default — nothing is rewritten).
 *   - Its owner shares it: `sharing: {<person id>: 'see' | 'work'}`. `see` opens it and reads its parameters and chats;
 *     `work` also changes the parameters, runs the build and chats in it.
 *   - Anyone holding host sees and works on every project, and may change any project's owner and sharing (host is the
 *     machine, and a project is a folder on it). Everyone else only their own and those shared with them; the rest
 *     answer 404, as if absent (harness/session-access.js, the conversations' rule).
 *   - Who set what is kept on the project (`audit`: made, shared, unshared, owner changed — who, when, from, to).
 *   - No person (a test, a call before accounts) is not narrowed, as everywhere else.
 * A device acts as its person (api-v1 deviceOwner), so the same rule holds for it with no rule of its own.
 */
const RIGHTS = ['see', 'work'];
const AUDIT_KEPT = 100;
const notFound = id => Object.assign(new Error(`No project "${id}".`), { status: 404 });
const isHost = person => require('../harness/session-access').isHost(person);

/** What `person` holds on `p`: 'host' | 'owner' | 'work' | 'see' | null. */
function rightOn(person, p) {
  if (!p) return null;
  if (!person?.id || isHost(person)) return 'host';
  if (p.owner?.id && p.owner.id === person.id) return 'owner';
  const r = p.sharing?.[person.id];
  return RIGHTS.includes(r) ? r : null;
}

const maySee = (person, p) => !!rightOn(person, p);
const mayWork = (person, p) => ['host', 'owner', 'work'].includes(rightOn(person, p));
/** Changing who owns it and who it is shared with: its owner, or a host. */
const mayManage = (person, p) => ['host', 'owner'].includes(rightOn(person, p));

/** The project if this person may see it (and work on it, with `work`); 404 otherwise, 403 for see-only asked to work. */
function need(person, id, { work = false, manage = false } = {}) {
  const p = require('./store').get(id);
  if (!p || !maySee(person, p)) throw notFound(id);
  if (manage && !mayManage(person, p)) throw Object.assign(new Error('Only its owner, or an admin, changes who has this project.'), { status: 403 });
  if (work && !mayWork(person, p)) throw Object.assign(new Error(`“${p.name}” is shared with you to see, not to work on: ask its owner.`), { status: 403 });
  return p;
}

function visible(person, list) { return list.filter(p => maySee(person, p)); }

/** The person a request comes from, as a turn sees them (role included). */
function personOfReq(req) { return require('../harness/turn/client').personOf(req.auth); }   // the shape a conversation keeps: id, name, email, role, orgId

/** The person a tool call acts for: the turn's own, else whoever owns the conversation up the chain (a mission's). */
function personOfCtx(ctx = {}) {
  if (ctx.user?.id) return ctx.user;
  const owner = ctx.sessionId ? require('../harness/session-access').ownerOf(ctx.sessionId) : null;
  return owner ? personById(owner) : null;
}

function personById(id) {
  if (!id) return null;
  return require('../harness/turn/client').personById({ id, orgId: require('../auth/store').defaultOrg()?.id || null });
}

const nameOf = id => {
  try { const u = require('../auth/store').userById(id); return u ? (u.name || String(u.email || '').split('@')[0] || id) : null; } catch { return null; }
};
const who = person => (person?.id ? { id: person.id, name: person.name || nameOf(person.id) || person.id } : { id: null, name: 'the hub' });

/** One line of who set what, kept on the project (the newest AUDIT_KEPT). */
function entry(person, what, more = {}) { return { at: new Date().toISOString(), by: who(person), what, ...more }; }
function withAudit(p, e) { return [...(p.audit || []), e].slice(-AUDIT_KEPT); }

/** The fields a new project starts with: its maker as owner, shared with nobody. */
function birth(person) {
  return { ...(person?.id ? { owner: { id: person.id, orgId: person.orgId || null } } : {}), sharing: {}, audit: [entry(person, 'created')] };
}

/** Share with one person (`right` see | work), or stop (`right` none). */
function share(person, id, { personId, right } = {}) {
  const store = require('./store');
  const p = need(person, id, { manage: true });
  const pid = String(personId || '');
  if (!pid || !nameOf(pid)) throw Object.assign(new Error('Share with someone of this hive (a person id).'), { status: 400 });
  if (pid === p.owner?.id) throw Object.assign(new Error('That is its owner.'), { status: 400 });
  const to = right === 'none' || right == null ? null : String(right);
  if (to && !RIGHTS.includes(to)) throw Object.assign(new Error('A share is "see", "work" or "none".'), { status: 400 });
  const from = p.sharing?.[pid] || null;
  if (from === to) return p;
  const sharing = { ...(p.sharing || {}) };
  if (to) sharing[pid] = to; else delete sharing[pid];
  return store.setAccess(id, { sharing, audit: withAudit(p, entry(person, to ? 'shared' : 'unshared', { person: { id: pid, name: nameOf(pid) }, from, to })) });
}

/** A new owner (a host's: an owner giving a project away would lose it in one click). */
function setOwner(person, id, ownerId) {
  const store = require('./store');
  const p = need(person, id);
  if (!isHost(person)) throw Object.assign(new Error('Only an admin changes a project\'s owner.'), { status: 403 });
  const nid = String(ownerId || '');
  if (!nameOf(nid)) throw Object.assign(new Error('The owner is someone of this hive (a person id).'), { status: 400 });
  if (p.owner?.id === nid) return p;
  const sharing = { ...(p.sharing || {}) };
  delete sharing[nid];
  const from = p.owner?.id ? { id: p.owner.id, name: nameOf(p.owner.id) } : null;
  return store.setAccess(id, { owner: { id: nid, orgId: person?.orgId || p.owner?.orgId || null }, sharing,
    audit: withAudit(p, entry(person, 'owner', { from, to: { id: nid, name: nameOf(nid) } })) });
}

/** What the panel shows: owner, shares with names, who set what, and the people one could share with. */
function view(person, id) {
  const p = need(person, id);
  const orgId = person?.orgId || require('../auth/store').defaultOrg()?.id || null;
  return {
    owner: p.owner?.id ? { id: p.owner.id, name: nameOf(p.owner.id) } : null,
    yours: rightOn(person, p), manage: mayManage(person, p),
    shares: Object.entries(p.sharing || {}).map(([pid, right]) => ({ id: pid, name: nameOf(pid) || pid, right })),
    audit: (p.audit || []).slice().reverse(),
    people: mayManage(person, p) ? require('../meetings/access').directory(orgId) : [],
  };
}

module.exports = { RIGHTS, rightOn, maySee, mayWork, mayManage, need, visible, personOfReq, personOfCtx, personById, birth, share, setOwner, view, isHost };
