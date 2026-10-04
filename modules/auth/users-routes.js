'use strict';

/**
 * Settings → Users & levels (auth phase 2, docs/design/permissions.md §4):
 * people, their permission level, and the levels themselves. Every route needs
 * the `users` right (rights.js) and a recent sign-in (STEP_UP).
 *
 * The rules that keep this from being a way up:
 *   - you give only a level that holds nothing you do not (an admin cannot make owners);
 *   - only an owner changes an owner;
 *   - nobody changes their own level or suspends themselves;
 *   - the last owner stays an owner.
 * A new account gets a one-time password, shown once, replaced at first sign-in.
 */
const store = require('./store');
const levels = require('./levels');
const credentials = require('./credentials');

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const wrap = fn => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};

function orgOf(req) { return req.auth.orgId || store.defaultOrg()?.id; }

function people(orgId) {
  return store.membersOf(orgId).map(m => {
    const u = store.userById(m.userId);
    if (!u) return null;
    return { id: u.id, email: u.email, name: u.name, level: m.role, status: m.status, suspended: !!u.suspendedAt,
      mustChangePassword: !!u.mustChangePassword, createdAt: u.createdAt, sessions: store.sessionsOf(u.id).length };
  }).filter(Boolean);
}

function owners(orgId) { return store.membersOf(orgId).filter(m => m.role === 'owner' && m.status === 'active' && !store.userById(m.userId)?.suspendedAt); }

function mayChange(req, targetId) {
  const orgId = orgOf(req);
  if (targetId === req.auth.user.id) throw bad('You cannot change your own level or suspend yourself; another person with the users right can.', 403);
  const m = store.membership(orgId, targetId);
  if (!m) throw bad('No such person here.', 404);
  if (m.role === 'owner' && req.auth.role !== 'owner') throw bad('Only an owner changes an owner.', 403);
  return m;
}

function mayGive(req, level) {
  if (!levels.get(level)) throw bad(`No level ${level}.`, 404);
  if (!levels.within(level, req.auth.role)) throw bad(`${levels.get(level).name} holds rights you do not, so you cannot give it.`, 403);
}

function mount(app) {
  app.get('/api/auth/users', wrap(req => ({ users: people(orgOf(req)), levels: levels.list() })));

  app.post('/api/auth/users', wrap(async req => {
    const { email, name = '', level = 'member' } = req.body || {};
    mayGive(req, level);
    const password = credentials.oneTimePassword();
    const user = store.createUser({ email, name, passwordHash: await credentials.hashPassword(password), mustChangePassword: true });
    store.addMembership({ orgId: orgOf(req), userId: user.id, role: level, status: 'active', approvedBy: req.auth.user.id });
    store.audit({ orgId: orgOf(req), actorId: req.auth.user.id, subjectId: user.id, action: 'user created', detail: `${user.email} as ${level}` });
    return { user: people(orgOf(req)).find(p => p.id === user.id), oneTimePassword: password };
  }));

  app.patch('/api/auth/users/:id', wrap(req => {
    const orgId = orgOf(req), m = mayChange(req, req.params.id), b = req.body || {};
    if (b.level !== undefined && b.level !== m.role) {
      mayGive(req, b.level);
      if (m.role === 'owner' && owners(orgId).length <= 1) throw bad('This is the last owner; make someone else an owner first.', 409);
      store.addMembership({ orgId, userId: m.userId, role: b.level, status: m.status, approvedBy: req.auth.user.id });
      store.audit({ orgId, actorId: req.auth.user.id, subjectId: m.userId, action: 'level changed', detail: `${m.role} → ${b.level}` });
    }
    if (b.suspended !== undefined) {
      if (b.suspended && m.role === 'owner' && owners(orgId).length <= 1) throw bad('This is the last owner.', 409);
      store.updateUser(m.userId, { suspendedAt: b.suspended ? new Date().toISOString() : null });
      if (b.suspended) store.deleteSessionsOf(m.userId);
      store.audit({ orgId, actorId: req.auth.user.id, subjectId: m.userId, action: b.suspended ? 'user suspended' : 'user restored' });
    }
    if (b.name !== undefined) store.updateUser(m.userId, { name: String(b.name).trim().slice(0, 80) });
    return { user: people(orgId).find(p => p.id === m.userId) };
  }));

  app.post('/api/auth/users/:id/password', wrap(async req => {
    const m = mayChange(req, req.params.id);
    const password = credentials.oneTimePassword();
    store.updateUser(m.userId, { passwordHash: await credentials.hashPassword(password), mustChangePassword: true });
    store.deleteSessionsOf(m.userId);
    store.audit({ orgId: orgOf(req), actorId: req.auth.user.id, subjectId: m.userId, action: 'password reset' });
    return { oneTimePassword: password };
  }));

  app.delete('/api/auth/users/:id/sessions', wrap(req => {
    const m = mayChange(req, req.params.id);
    store.deleteSessionsOf(m.userId);
    return { ok: true };
  }));

  // Grants: exceptions to a level (auth/grants.js), given by someone holding delegate, within what they hold.
  const giver = req => ({ ...req.auth.user, role: req.auth.role });
  const mayManage = req => { if (!levels.rightsOf(req.auth.role).some(r => r === 'users' || r === 'delegate')) throw bad('Managing grants needs the users or delegate right.', 403); };
  app.get('/api/auth/grants', wrap(req => { mayManage(req); return { grants: require('./grants').list({ all: req.query.all === '1' }) }; }));
  app.post('/api/auth/grants', wrap(req => {
    const g = require('./grants'), b = req.body || {};
    const why = require('./permits').mayGrant({ giver: giver(req), subject: b.subject || {}, permission: String(b.permission || '') });
    if (why) throw bad(`Not given: ${why}.`, 403);
    const made = g.create({ subject: b.subject, permission: b.permission, scope: b.scope || 'permanent', expiresAt: b.expiresAt || null,
      note: b.note, by: { kind: 'user', id: req.auth.user.id, user: req.auth.user.id } });
    store.audit({ orgId: orgOf(req), actorId: req.auth.user.id, action: 'grant given', detail: `${made.permission} to ${made.subject.kind} ${made.subject.id}` });
    return { grant: made };
  }));
  app.delete('/api/auth/grants/:id', wrap(req => {
    const g = require('./grants'), cur = g.get(req.params.id);
    if (!cur) throw bad('No such grant.', 404);
    if (cur.by.user !== req.auth.user.id) mayManage(req);
    store.audit({ orgId: orgOf(req), actorId: req.auth.user.id, action: 'grant revoked', detail: `${cur.permission} from ${cur.subject.kind} ${cur.subject.id}` });
    return { grant: g.revoke(req.params.id) };
  }));

  app.get('/api/auth/levels', wrap(() => ({ levels: levels.list(), rights: levels.RIGHTS })));
  app.post('/api/auth/levels', wrap(req => ({ level: levels.create(req.body || {}, { actorLevel: req.auth.role }) })));
  app.patch('/api/auth/levels/:id', wrap(req => ({ level: levels.update(req.params.id, req.body || {}, { actorLevel: req.auth.role }) })));
  app.delete('/api/auth/levels/:id', wrap(req => levels.remove(req.params.id, {
    actorLevel: req.auth.role, inUse: store.membersOf(orgOf(req)).filter(m => m.role === req.params.id).length })));
}

module.exports = { mount };
