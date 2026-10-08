'use strict';

/**
 * Budgets: opt-in limits on what a person's agents spend (CONSTITUTION S12, S13; docs/design/spending.md §3).
 *
 * A budget is { tokensPerDay, tokensPerMonth, moneyPerDay, moneyPerMonth }; 0 or absent is none, and none exists until
 * somebody sets one. Three places may set one and the tightest of each field wins: the person's own, an admin's for
 * that person, and their level's default. The owner is bound only by their own — nothing an install ships, and
 * nothing another admin sets, lowers the owner's limits.
 *
 * Checked when a turn starts (turn/ceiling.js), never mid-flight; at the budget the turn is refused with which budget,
 * what was used and who can raise it.
 */
const store = require('./store');

const FIELDS = {
  tokensPerDay:   { what: 'a day',   unit: 'tokens', period: 'today' },
  tokensPerMonth: { what: 'a month', unit: 'tokens', period: 'month' },
  moneyPerDay:    { what: 'a day',   unit: 'money',  period: 'today' },
  moneyPerMonth:  { what: 'a month', unit: 'money',  period: 'month' },
};
const FROM = { own: 'their own', admin: 'an admin\'s, for them', leader: 'their team leader\'s', level: 'their level\'s' };

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** A budget as stored: positive numbers only, or null when it limits nothing. Refuses a negative or non-number. */
function normalize(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const k of Object.keys(FIELDS)) {
    const v = input[k];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw bad(`${k} is a number, 0 or more (0 is no budget).`);
    if (n > 0) out[k] = k.startsWith('tokens') ? Math.floor(n) : Math.round(n * 100) / 100;
  }
  return Object.keys(out).length ? out : null;
}

const isOwner = person => person?.role === 'owner';

/** Where this person's budgets come from: [{ from, budget }]. */
function sources(person, d = store.load()) {
  if (!person?.id) return [];
  const mine = d.people[person.id] || {};
  const out = [{ from: 'own', budget: mine.own }];
  if (!isOwner(person)) out.push({ from: 'admin', budget: mine.budget }, { from: 'leader', budget: mine.leader }, { from: 'level', budget: d.levels[person.role]?.budget });
  return out.filter(s => s.budget);
}

/**
 * The tightest of each field: { <field>: { limit, from } }, or null when nothing limits this person. `without` leaves
 * one source out — 'own', for a turn its person chose to take over their own budget (spending/over.js).
 */
function effective(person, d, { without = null } = {}) {
  const out = {};
  for (const { from, budget } of sources(person, d).filter(s => s.from !== without))
    for (const [k, v] of Object.entries(budget)) if (!out[k] || v < out[k].limit) out[k] = { limit: v, from };
  return Object.keys(out).length ? out : null;
}

const fmt = (unit, n, currency) => (unit === 'tokens' ? `${Math.round(n)} tokens` : `${n.toFixed(2)} ${currency}`);

/** The person the turn's spend counts against: the conversation's, else the one on the turn. */
function personFor({ person, sessionId }) {
  let id = null;
  try { id = sessionId ? require('../harness/session-access').ownerOf(sessionId) : null; } catch { /* no such conversation */ }
  if (!id || id === person?.id) return person || null;
  return require('../harness/turn/client').personById({ id, orgId: person?.orgId || require('../auth/store').defaultOrg()?.id }) || person || null;
}

/**
 * This person's budget against what they spent: { budget, spent, over } — `over` the first field reached, or null.
 * Reads the ledger only when a budget exists, so a person without one costs nothing.
 */
async function state(person, now = new Date(), opts = {}) {
  const budget = effective(person, undefined, opts);
  if (!budget) return { budget: null, spent: null, over: null };
  const spent = await require('./spent').of(person.id, now);
  let over = null;
  for (const [k, { limit, from }] of Object.entries(budget)) {
    const used = spent[FIELDS[k].period][FIELDS[k].unit === 'tokens' ? 'tokens' : 'money'];
    if (used >= limit) { over = { field: k, limit, from, used }; break; }
  }
  return { budget, spent, over };
}

/** Throws, saying which budget and who can raise it, when this person's is reached. */
async function check(person, now = new Date(), opts = {}) {
  const s = await state(person, now, opts);
  if (!s.over) return s;
  const { field, limit, from, used } = s.over, f = FIELDS[field], cur = s.spent.currency;
  const raise = from === 'own' ? 'They can raise or clear it in Settings → Spending.'
    : from === 'level' ? `It is the default of the level "${person.role}"; an admin can change it in Settings → Spending.`
      : from === 'leader' ? 'Their team leader, or an admin, can raise it in Settings → Spending.'
      : 'An admin can raise it in Settings → Spending.';
  const what = `${fmt(f.unit, limit, cur)} ${f.what}`, spent = `${fmt(f.unit, used, cur)} used ${f.period === 'today' ? 'today (UTC)' : 'this month'}`;
  throw Object.assign(new Error(`Not started: ${person.name || 'this person'}'s budget of ${what} (${FROM[from]}) is reached — ${spent}. ${raise}`),
    { status: 429, code: 'budget_reached', over: { field, limit, from, used, what, spent }, personId: person.id });
}

/** The budget part of the agent's spending line, or ''. */
function describe(s) {
  if (!s?.budget) return '';
  const cur = s.spent.currency;
  return 'budget ' + Object.entries(s.budget).map(([k, { limit }]) => {
    const f = FIELDS[k], used = s.spent[f.period][f.unit === 'tokens' ? 'tokens' : 'money'];
    return `${fmt(f.unit, limit, cur)} ${f.what} (used ${fmt(f.unit, used, cur)})`;
  }).join(', ');
}

const holdsUsers = actor => require('../auth/rights').can(actor?.role, 'users');

/**
 * A team leader (CONSTITUTION S13: the admin "can let others grant specific permissions"): a person whose level holds
 * `delegate` and whose `delegates` names `budget` (or names nothing, which is anything they hold) sets budgets for
 * people of their level or below — never the owner, never themselves this way. Their budget is a slot of its own and
 * the tightest wins, so a leader narrows what an admin set, and never loosens it.
 */
function leads(actor, personId) {
  if (!actor?.id || !personId || personId === actor.id) return false;
  const levels = require('../auth/levels'), L = levels.get(actor.role);
  if (!L || !(L.rights || []).includes('delegate')) return false;
  if (L.delegates && !L.delegates.some(p => p === '*' || p === 'budget')) return false;
  const authStore = require('../auth/store'), orgId = actor.orgId || authStore.defaultOrg()?.id;
  const role = orgId ? authStore.membership(orgId, personId)?.role : null;
  return !!role && role !== 'owner' && levels.within(role, actor.role);
}

/**
 * Set a budget. For yourself it is your own; for another person, or a level's default (with what that level's people
 * may allow themselves to be spent, permissions.js), it is an admin's (`users`).
 */
/**
 * The body's shape, said when it is wrong (deep test A, e2 C1): `{personId, tokensPerDay}` answered 200 and set no
 * budget at all — a 200 with no limit is the wrong answer for a spending control.
 */
const SHAPE = 'Expected {personId?, levelId?, budget: {tokensPerDay?, tokensPerMonth?, moneyPerDay?, moneyPerMonth?}} — '
  + 'the amounts go inside "budget" (null or {} clears it); a level also takes mayAllow.';
function checkShape(body, { levelId, budget, mayAllow }) {
  const flat = Object.keys(FIELDS).filter(k => body[k] !== undefined);
  if (flat.length) throw bad(`${flat.join(', ')} must be inside "budget". ${SHAPE}`);
  const extra = Object.keys(body).filter(k => !['personId', 'levelId', 'budget', 'mayAllow'].includes(k));
  if (extra.length) throw bad(`Not a budget field: ${extra.join(', ')}. ${SHAPE}`);
  if (budget === undefined && !(levelId && mayAllow !== undefined)) throw bad(`No "budget" in the request. ${SHAPE}`);
  if (budget !== undefined && budget !== null && (typeof budget !== 'object' || Array.isArray(budget))) throw bad(`"budget" is an object or null. ${SHAPE}`);
  const unknown = budget ? Object.keys(budget).filter(k => !FIELDS[k]) : [];
  if (unknown.length) throw bad(`Not a budget amount: ${unknown.join(', ')}. ${SHAPE}`);
}

function set(actor, body = {}) {
  const { personId, levelId, budget, mayAllow } = body;
  if (!actor?.id) throw bad('Sign in first.', 401);
  checkShape(body, body);
  const b = normalize(budget);
  if (levelId) {
    if (!holdsUsers(actor)) throw bad('A level\'s budget is an admin\'s to set.', 403);
    if (!require('../auth/levels').get(levelId)) throw bad('No such level.', 404);
    const allow = mayAllow === undefined ? undefined : mayAllow === null || mayAllow === '' ? null : Number(mayAllow);
    if (allow !== undefined && allow !== null && (!Number.isFinite(allow) || allow < 0)) throw bad('mayAllow is an amount, 0 or more, or empty for none.');
    return store.change(d => {
      const L = { ...(d.levels[levelId] || {}), ...(budget !== undefined ? { budget: b } : {}) };   // mayAllow alone keeps the budget
      if (allow !== undefined) L.mayAllow = allow;
      d.levels[levelId] = L;
      return L;
    });
  }
  const own = !personId || personId === actor.id;
  const slot = own ? 'own' : holdsUsers(actor) ? 'budget' : leads(actor, personId) ? 'leader' : null;
  if (!slot) throw bad('Another person\'s budget is an admin\'s to set, or their team leader\'s.', 403);
  if (!own && !require('../auth/store').userById(personId)) throw bad('No such person.', 404);
  return store.change(d => {
    const P = d.people[own ? actor.id : personId] || (d.people[own ? actor.id : personId] = {});
    P[slot] = b;
    return P;
  });
}

module.exports = { FIELDS, normalize, sources, effective, personFor, state, check, describe, set, leads };
