'use strict';

/**
 * The agent's way to models for people (tool `people_models`; the owner's decision of 2026-10-16): when a person asks —
 * "give Marco the cheap model", "nobody below me gets a model assigned" — the agent prepares the exact change, and it
 * lands as a proposal card in that conversation. Which models people run on is a password switch (CONSTITUTION S14,
 * auth/guarded.js `peopleModels`), so the card's Accept asks the person's password, and nothing is written before it:
 * never applied from a turn, not with `asked`, not in Unattended.
 *
 * Every change is checked when proposed AS THE PERSON THE TURN IS FOR (assign.js: who they may assign to, what is
 * allotted), and again when accepted as the person who accepts — a proposal file can be edited, and a different admin
 * may click it.
 */
const as = require('./assign');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** A person by id, e-mail or name (exact, then unique prefix, any case), among the org's members. */
function personNamed(actor, said) {
  const s = require('../auth/store'), orgId = actor?.orgId || s.defaultOrg()?.id;
  const want = String(said || '').trim().toLowerCase();
  const all = (orgId ? s.membersOf(orgId) : []).map(m => ({ m, u: s.userById(m.userId) })).filter(x => x.u);
  const exact = all.filter(({ u }) => [u.id, u.email, u.name].some(v => String(v || '').toLowerCase() === want));
  const hits = exact.length ? exact : all.filter(({ u }) => String(u.name || '').toLowerCase().startsWith(want) || String(u.email || '').toLowerCase().startsWith(want));
  if (hits.length !== 1) throw bad(hits.length ? `"${said}" could be ${hits.map(h => h.u.name || h.u.email).join(' or ')} — name one.` : `Nobody here is called "${said}".`);
  return { id: hits[0].u.id, name: hits[0].u.name || hits[0].u.email, role: hits[0].m.role };
}

function levelNamed(said) {
  const want = String(said || '').trim().toLowerCase();
  const l = require('../auth/levels').list().find(x => x.id.toLowerCase() === want || String(x.name).toLowerCase() === want);
  if (!l) throw bad(`No level called "${said}".`);
  return l;
}

/** "nothing" / "none" → NONE; "not set" / "" / "clear" → ''; else provider/model as given. */
function modelOf(v) {
  const s = String(v ?? '').trim();
  if (/^(none|nothing|nothing assigned|no model)$/i.test(s)) return as.NONE;
  if (/^(|not set|unset|clear|default)$/i.test(s)) return '';
  return s;
}

/**
 * Check and file a proposal of changes [{person?|level?|everyone_below?, model}] for `actor` (the person on the turn).
 * `everyone_below: true` expands to every level below them that is not already set to the same.
 */
function propose(actor, { changes, reason } = {}, { sessionId } = {}) {
  if (!actor?.id) throw bad('Nobody is on this turn: models for people are assigned for a person, in their own conversation.', 403);
  if (!as.isAdmin(actor)) throw bad(`${actor.name || 'This person'} may not assign models: that is an admin's (users), or a team leader allowed to give models.`, 403);
  const levels = require('../auth/levels');
  const want = [];
  for (const c of Array.isArray(changes) ? changes : []) {
    const model = modelOf(c.model);
    if (c.everyone_below) { for (const l of levels.list().filter(l => as.mayLevel(actor, l.id))) want.push({ levelId: l.id, name: `level ${l.name}`, model }); continue; }
    if (c.level) { const l = levelNamed(c.level); want.push({ levelId: l.id, name: `level ${l.name}`, model }); continue; }
    if (c.person) { const p = personNamed(actor, c.person); want.push({ personId: p.id, name: p.name, model }); continue; }
    throw bad('Each change names a person, a level, or everyone_below: true.');
  }
  if (!want.length || want.length > 100) throw bad('Name 1 to 100 changes.');
  want.forEach(w => as.set(actor, { personId: w.personId, levelId: w.levelId, model: w.model }, { dry: true }));   // throws with why, as the asker
  const view = require('./routes').view(actor);
  const cur = w => (w.personId ? view.people.find(x => x.id === w.personId) : view.levels.find(x => x.id === w.levelId)) || {};
  const slot = actor.role === 'owner' ? 'owner' : 'admin';
  const word = m => (m === as.NONE ? 'nothing assigned' : m || 'not set');
  const rows = want.map(w => ({ path: `models for ${w.name}`, from: word(cur(w)[slot]?.model || ''), to: word(w.model), section: 'Models for people',
    note: `${slot === 'owner' ? 'The owner\'s' : 'An admin\'s'} rule`, target: { personId: w.personId || null, levelId: w.levelId || null, model: w.model } }));
  return require('../harness/settings').proposeOther({ kind: 'people-models', changes: rows, reason, sessionId, by: actor.id });
}

/** Accept: each change again, as the person who accepted (assign.setMany: all or nothing). */
function apply(p, person) {
  if (!person?.id) throw bad('Sign in to accept it.', 401);
  return as.setMany(person, p.changes.map(c => ({ personId: c.target?.personId || undefined, levelId: c.target?.levelId || undefined, model: c.target?.model ?? '' })));
}

module.exports = { propose, apply, personNamed, levelNamed, modelOf };
