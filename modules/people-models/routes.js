'use strict';

/**
 * Settings → Users → Models for people, for whoever may assign (assign.js; the owner's decision of 2026-10-16):
 *
 *   GET  /api/people-models          the people and levels this person may assign to — only those — each with the
 *                                     owner's assignment, an admin's (who set it, when) and which one counts; the
 *                                     owner's switches for the owner alone
 *   POST /api/people-models/assign   {personId | levelId, model} or {changes: [...]}: model is provider/model, "none"
 *                                     (nothing assigned) or empty (not set); asks for the password (auth/guarded.js)
 *
 * Right `read` at the gate; who is an admin here (users, or a team leader for models) is assign.js's, checked inside.
 */
const as = require('./assign');

const RULE = 'The first rule that is set decides, in this order: the owner\'s for the person, an admin\'s for the person, the owner\'s for their level, an admin\'s for their level, the owner\'s for everyone. "Nothing assigned" is set: broader rules after it no longer reach them, and they run on their own choice or the owner\'s models as the policy says. "Not set" passes to the next rule.';

const actorOf = req => require('../harness/turn/client').personOf(req.auth);

function nameOf(id) {
  if (!id) return null;
  const u = require('../auth/store').userById(id);
  return u?.name || u?.email || null;
}

/** What decides for a person: the model, or "nothing assigned"; whose rule (owner/admin), which (person/level/everyone), by whom. */
function counts(person) {
  const a = require('./index').ruleFor(person);
  return a ? { model: a.none ? null : `${a.provider}/${a.model}`, none: !!a.none, setBy: a.setBy, from: a.from, by: a.by || null,
    byName: nameOf(a.by) || (a.setBy === 'owner' ? 'the owner' : null) } : null;
}

function view(actor) {
  if (!as.isAdmin(actor)) throw Object.assign(new Error('Assigning models is an admin\'s.'), { status: 403 });
  const pm = require('./index'), pol = pm.policy(), d = as.load();
  const s = require('../auth/store'), orgId = actor.orgId || s.defaultOrg()?.id;
  const levels = require('../auth/levels');
  const admin = r => (r ? { model: r.model, by: r.by, byName: nameOf(r.by), at: r.at } : null);
  const cand = require('./candidates'), named = cand.named();
  const ownerRec = (where, key, model) => (model ? { model, by: as.ownerBy(where, key, model, d)?.by || null, byName: nameOf(as.ownerBy(where, key, model, d)?.by) || 'the owner' } : null);
  const people = (orgId ? s.membersOf(orgId) : []).filter(m => s.userById(m.userId) && as.mayPerson(actor, m.userId)).map(m => {
    const u = s.userById(m.userId) || {};
    const person = { id: m.userId, role: m.role, name: u.name || u.email };
    return { id: m.userId, name: u.name || u.email || m.userId, level: m.role, levelName: levels.get(m.role)?.name || m.role,
      owner: ownerRec('people', m.userId, pol.people?.[m.userId]), admin: admin(d.people[m.userId]), counts: counts(person), options: cand.forTarget(person, named) };
  });
  const lv = levels.list().filter(l => as.mayLevel(actor, l.id)).map(l => ({ id: l.id, name: l.name,
    owner: ownerRec('levels', l.id, pol.levels?.[l.id]), admin: admin(d.levels[l.id]), options: cand.forTarget({ id: `level:${l.id}`, role: l.id, name: l.name }, named) }));
  const isOwner = actor.role === 'owner';
  return { me: { role: actor.role, owner: isOwner, mayChoose: pm.mayChoose(actor, pol) }, policy: isOwner ? pol : { assign: pol.assign },
    people, levels: lv, none: require('./index').NONE, rule: RULE };
}

function mount(app) {
  const h = fn => (req, res) => {
    const actor = actorOf(req);
    if (!actor?.id) return res.status(401).json({ error: 'Sign in first.' });
    try { res.json(fn(req, actor)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  };
  app.get('/api/people-models', h((req, actor) => view(actor)));
  // One change, or `changes: [...]` saved together (one Save, one password): all or nothing.
  app.post('/api/people-models/assign', h((req, actor) => (Array.isArray(req.body?.changes) ? { changes: as.setMany(actor, req.body.changes) } : as.set(actor, req.body || {}))));
}

module.exports = { mount, view, RULE };
