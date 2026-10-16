'use strict';

/**
 * Who may assign models to whom (the owner's decision of 2026-10-16, branch team-oversight): "admins can choose the
 * model for themselves and the users below them".
 *
 *   - The owner (role `owner`) assigns to anyone but an owner, in the policy itself (prefs `peopleModels.people` and
 *     `.levels`, index.js) — as before, now also through POST /api/people-models/assign, which records who set it.
 *   - An admin — a level holding `users`, or a team leader: a level holding `delegate` whose `delegates` names nothing,
 *     `*`, `model` or a `use:model:` pattern (the same reading as spending/budgets.js `leads`) — assigns to people and
 *     levels strictly BELOW their own level (levels.within one way and not the other): never an equal, never a higher
 *     level, never the owner, never themselves (their own model is their own choice in the chat, index.js mayChoose).
 *     Their assignments are a slot of their own, kept here (store `people-models-assigned`), with who set it and when.
 *   - Never beyond what auth/allot.js allots to that person (or to that level), nor, for a leader without host, to
 *     the leader: a team leader gives only what they could use and their level lets them give.
 *
 * Where the owner and an admin both assign, the owner's wins, rule by rule from the most specific: the owner's for the
 * person, then an admin's for the person, then the owner's for their level, then an admin's for the level, then the
 * owner's "everyone but me" (index.js assignedFor). Every change asks for the password (auth/guarded.js, peopleModels).
 */
const store = require('../store');

const DOC = 'people-models-assigned';
const NONE = 'none';   // "nothing assigned", on purpose (index.js ruleFor); empty or absent is "not set"
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const load = () => { const d = store.readJson(DOC, {}) || {}; return { people: d.people || {}, levels: d.levels || {}, owner: d.owner || { people: {}, levels: {} } }; };
const levels = () => require('../auth/levels');
const can = (role, right) => require('../auth/rights').can(role, right);
const isOwner = p => p?.role === 'owner';

/** A team leader for models: delegate, and their level's `delegates` lets them give models. */
function leadsModels(actor) {
  const L = levels().get(actor?.role);
  if (!L || !(L.rights || []).includes('delegate')) return false;
  return !L.delegates || L.delegates.some(p => p === '*' || p === 'model' || String(p).startsWith('use:model:'));
}

/** Holds `users`, or leads for models: an admin in the owner's sense. */
const isAdmin = actor => !!actor?.id && (isOwner(actor) || can(actor.role, 'users') || leadsModels(actor));

/** Level `a` strictly below level `b`: nothing `a` grants that `b` does not, and `b` grants something more. */
const below = (a, b) => a !== 'owner' && levels().within(a, b) && !levels().within(b, a);

function roleOf(personId, actor) {
  const s = require('../auth/store'), orgId = actor?.orgId || s.defaultOrg()?.id;
  return orgId ? s.membership(orgId, personId)?.role || null : null;
}

/** May `actor` assign a model to this person? */
function mayPerson(actor, personId) {
  if (!actor?.id || !personId || personId === actor.id) return false;
  const role = roleOf(personId, actor);
  if (!role || role === 'owner') return false;
  if (isOwner(actor)) return true;
  return isAdmin(actor) && below(role, actor.role);
}

/** May `actor` assign a model to every person of this level? */
function mayLevel(actor, levelId) {
  if (!actor?.id || !levels().get(levelId) || levelId === 'owner') return false;
  if (isOwner(actor)) return true;
  return isAdmin(actor) && below(levelId, actor.role);
}

/** Whether the model is allotted to whom it is for, and — for a leader without host — to the leader, and theirs to give. */
function allotted(actor, forWhom, e) {
  const allot = require('../auth/allot');
  if (!allot.allowsModel(forWhom, e)) throw bad(`${e.provider}/${e.model} is not allotted to ${forWhom.name || 'them'}: allot it first (Settings → Users → a level's models), or choose one they have.`, 403);
  if (isOwner(actor) || can(actor.role, 'host')) return;
  if (!allot.allowsModel(actor, e)) throw bad(`${e.provider}/${e.model} is not allotted to you, so it is not yours to give.`, 403);
  const may = levels().get(actor.role)?.delegates;
  const covers = p => p === '*' || p === 'model' || require('../auth/grants').covers(p, `use:model:${e.provider}/${e.model}`);
  if (!can(actor.role, 'users') && may && !may.some(covers)) throw bad(`Your level may give only ${may.join(', ')}.`, 403);
}

/**
 * Assign a model for a person or a level: `provider/model`, "none" (nothing assigned — the broader rules no longer reach
 * them), or empty (not set — the next rule decides). `dry` checks everything and writes nothing. The owner's goes into the policy (prefs),
 * an admin's into their slot here; both record who and when. Returns what is now set for that target.
 */
function set(actor, { personId, levelId, model } = {}, { dry = false } = {}) {
  if (!actor?.id) throw bad('Sign in first.', 401);
  if (!isAdmin(actor)) throw bad('Assigning models is an admin\'s: someone holding users, or a team leader allowed to give models.', 403);
  if (!!personId === !!levelId) throw bad('Name one person (personId) or one level (levelId).');
  const raw = String(model ?? '').trim(), none = raw === NONE;
  const e = raw && !none ? require('../harness/turn/model-route').parse(raw) : null;
  if (raw && !none && !e) throw bad(`"${raw}" is not provider/model, "${NONE}" (nothing assigned) or empty (not set).`);
  const s = require('../auth/store');
  let forWhom;
  if (personId) {
    if (!mayPerson(actor, personId)) throw bad(personId === actor.id ? 'Your own model is your choice in the chat\'s model picker.'
      : 'You may assign models only to people below your level (never an equal, a higher level or the owner).', 403);
    const u = s.userById(personId);
    forWhom = { id: personId, role: roleOf(personId, actor), name: u?.name || u?.email };
  } else {
    if (!mayLevel(actor, levelId)) throw bad('You may assign models only to levels below your own.', 403);
    forWhom = { id: `level:${levelId}`, role: levelId, name: `the level ${levels().get(levelId).name}` };
  }
  if (e) allotted(actor, forWhom, e);
  const where = personId ? 'people' : 'levels', key = personId || levelId;
  const rec = raw ? { model: none ? NONE : `${e.provider}/${e.model}`, by: actor.id, at: new Date().toISOString() } : null;
  if (dry) return { [personId ? 'personId' : 'levelId']: key, name: forWhom.name, to: rec?.model || null };
  const d = load();
  if (isOwner(actor)) {
    const utils = require('../utils'), prefs = utils.loadPrefs();
    const pm = { ...(prefs.peopleModels || {}) };
    pm[where] = { ...(pm[where] || {}) };
    if (rec) pm[where][key] = rec.model; else delete pm[where][key];
    utils.savePrefs({ ...prefs, peopleModels: pm });
    if (rec) d.owner[where] = { ...(d.owner[where] || {}), [key]: rec }; else delete d.owner[where]?.[key];
  } else if (rec) d[where][key] = rec;
  else delete d[where][key];
  store.writeJson(DOC, d);
  try { s.audit({ actorId: actor.id, action: 'peopleModels.assign', detail: `${personId ? 'person' : 'level'} ${key}: ${rec?.model || 'cleared'}` }); } catch { /* the record must not stop the change */ }
  return { [where.slice(0, -1)]: key, model: rec?.model || null, by: rec ? actor.id : null };
}

/** An admin's assignment for this person, by rule: {model, by, at, from: 'person'|'level'}, or null. */
function adminFor(person, d = load()) {
  if (!person?.id || isOwner(person)) return null;
  const p = d.people[person.id], l = d.levels[person.role];
  return p ? { ...p, from: 'person' } : l ? { ...l, from: 'level' } : null;
}

/** Who set the owner's assignment of this target, when the policy still holds what they set; else null. */
function ownerBy(where, key, model, d = load()) {
  const r = d.owner?.[where]?.[key];
  return r && r.model === model ? r : null;
}

/**
 * Several at once, all or nothing: every change is checked first (a dry run of each), then each is written — one Save,
 * one password (the route is guarded), and a refusal names which change and why without having written the others.
 */
function setMany(actor, changes) {
  const list = Array.isArray(changes) ? changes : [];
  if (!list.length || list.length > 100) throw bad('Send 1 to 100 changes, each {personId | levelId, model}.');
  list.forEach((c, i) => { try { set(actor, c, { dry: true }); } catch (e) { throw Object.assign(e, { message: `Change ${i + 1}: ${e.message}` }); } });
  return list.map(c => set(actor, c));
}

module.exports = { NONE, setMany, DOC, load, isAdmin, leadsModels, below, mayPerson, mayLevel, set, adminFor, ownerBy };
