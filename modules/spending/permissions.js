'use strict';

/**
 * Spending permissions (CONSTITUTION S12; docs/design/spending.md §4): "the agent may spend up to X on Y for person P".
 *
 *   on        { kind: service | provider | purchase, id } — id '*' is any of that kind
 *   upTo      an amount in the price list's currency: once for a one-time permission (then it is `used`), each
 *             calendar month for a permanent one — so a permission is never an open cheque
 *   state     proposed (the agent asked; nothing allowed yet) → active → used | revoked; or declined
 *
 * Made by a person for themselves within their level's `mayAllow`, or by an admin (`users`) for anyone; proposed by
 * the agent (`spend_propose`) and accepted by its person or an admin. Accepting, making and revoking ask for the
 * password (auth/guarded.js); declining never does — saying no is always free.
 */
const crypto = require('crypto');
const store  = require('./store');

const KINDS = ['service', 'provider', 'purchase'];
const ID = /^[\w.*:/@-]{1,80}$/;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const rights = () => require('../auth/rights');
const isAdmin = actor => rights().can(actor?.role, 'users');
const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);

function normalize({ on, upTo, permanent, why } = {}) {
  const kind = String(on?.kind || '').toLowerCase(), id = String(on?.id || '').trim().toLowerCase();
  if (!KINDS.includes(kind)) throw bad(`on.kind is one of: ${KINDS.join(', ')}.`);
  if (!ID.test(id)) throw bad('on.id names what is bought from: a service, a provider, or * for any of that kind.');
  const amount = Number(upTo);
  if (!Number.isFinite(amount) || amount <= 0) throw bad('upTo is an amount greater than 0.');
  return { on: { kind, id }, upTo: Math.round(amount * 100) / 100, permanent: !!permanent, why: String(why || '').slice(0, 300) };
}

/** The most a person may allow themselves in all: their level's `mayAllow`; any for someone holding host. */
function mayAllow(person, d = store.load()) {
  if (rights().can(person?.role, 'host')) return Infinity;
  const v = d.levels[person?.role]?.mayAllow;
  return Number.isFinite(Number(v)) && v !== null ? Number(v) : 0;
}

/**
 * What a person has already allowed against their `mayAllow`: every kept permission still active (each renews monthly)
 * plus this month's one-time ones, active or used. `mayAllow` caps the total, not each permission — capping each let
 * ten permissions of the most a level allows add up to ten times it (security review 2026-10-07).
 */
function allowed(personId, d, now = new Date()) {
  const month = monthOf(now);
  return d.permissions.filter(p => p.personId === personId && (p.permanent ? p.state === 'active'
    : ['active', 'used'].includes(p.state) && String(p.decidedAt || p.createdAt).slice(0, 7) === month))
    .reduce((a, p) => a + p.upTo, 0);
}

/** Whether `actor` may make or accept this permission for `personId`: an admin always; the person within their level. */
function mayGive(actor, personId, upTo, d) {
  if (isAdmin(actor)) return;
  if (actor?.id !== personId) throw bad('Another person\'s spending is theirs, or an admin\'s, to allow.', 403);
  const most = mayAllow(actor, d);
  if (!most) throw bad('Your level does not let you allow spending yourself; an admin can, in Settings → Spending.', 403);
  const already = allowed(personId, d);
  if (already + upTo > most) {
    throw bad(`Your level lets you allow up to ${most} in all, and ${Math.round(already * 100) / 100} is already allowed `
      + 'this month; an admin can allow more in Settings → Spending.', 403);
  }
}

const who = actor => (actor?.id ? { id: actor.id, name: actor.name || '' } : null);
const currency = () => require('../harness/prices').load().currency;

/** A person or an admin allows it now. */
function create(actor, input = {}) {
  const personId = input.personId || actor?.id;
  if (!personId) throw bad('Sign in first.', 401);
  const n = normalize(input);
  return store.change(d => {
    mayGive(actor, personId, n.upTo, d);
    const p = { id: `sp_${crypto.randomBytes(6).toString('hex')}`, personId, ...n, currency: currency(), state: 'active',
      by: who(actor), createdAt: new Date().toISOString(), decidedAt: new Date().toISOString(), decidedBy: who(actor), charges: [] };
    d.permissions.push(p);
    return p;
  });
}

/** The agent asks for one, for the person on its turn: waits as `proposed` until they (or an admin) decide. */
function propose(person, input = {}, { sessionId = null } = {}) {
  if (!person?.id) throw bad('Only a person\'s own conversation can ask to spend: nobody is on this turn.', 403);
  const n = normalize(input);
  return store.change(d => {
    const p = { id: `sp_${crypto.randomBytes(6).toString('hex')}`, personId: person.id, ...n, currency: currency(), state: 'proposed',
      by: { agent: true, sessionId }, createdAt: new Date().toISOString(), charges: [] };
    d.permissions.push(p);
    return p;
  });
}

function decide(actor, id, fn) {
  return store.change(d => {
    const p = d.permissions.find(x => x.id === id);
    if (!p || (!isAdmin(actor) && p.personId !== actor?.id)) throw bad('No such permission.', 404);
    fn(p, d);
    return p;
  });
}

/** Accept a proposal — once, or kept (`permanent`) when the person asks. */
const accept = (actor, id, { permanent } = {}) => decide(actor, id, (p, d) => {
  if (p.state !== 'proposed') throw bad(`This permission is ${p.state}, not waiting for an answer.`, 409);
  if (permanent !== undefined) p.permanent = !!permanent;
  mayGive(actor, p.personId, p.upTo, d);
  Object.assign(p, { state: 'active', decidedAt: new Date().toISOString(), decidedBy: who(actor) });
});

const decline = (actor, id) => decide(actor, id, p => {
  if (p.state !== 'proposed') throw bad(`This permission is ${p.state}, not waiting for an answer.`, 409);
  Object.assign(p, { state: 'declined', decidedAt: new Date().toISOString(), decidedBy: who(actor) });
});

const revoke = (actor, id) => decide(actor, id, p => {
  if (!['active', 'proposed'].includes(p.state)) throw bad(`This permission is already ${p.state}.`, 409);
  Object.assign(p, { state: 'revoked', revokedAt: new Date().toISOString(), revokedBy: who(actor) });
});

/** What is left of an active permission now: its whole amount once, or this month's rest. */
function left(p, now = new Date()) {
  if (p.state !== 'active') return 0;
  const spent = (p.charges || []).filter(c => !p.permanent || c.at.slice(0, 7) === monthOf(now)).reduce((a, c) => a + c.amount, 0);
  return Math.max(0, Math.round((p.upTo - spent) * 100) / 100);
}

const matches = (p, on) => p.on.kind === on.kind && (p.on.id === '*' || p.on.id === String(on.id || '').toLowerCase());

/** The active permission of this person's that covers spending `amount` on `on`, or null. */
function covers(personId, on, amount, now = new Date(), d = store.load()) {
  return d.permissions.find(p => p.personId === personId && p.state === 'active' && matches(p, on) && left(p, now) >= amount) || null;
}

/** Record a purchase against the permission that covers it: a one-time one is used up. Refuses when none covers it. */
function consume(personId, on, amount, { what = '' } = {}, now = new Date()) {
  return store.change(d => {
    const p = covers(personId, on, amount, now, d);
    if (!p) throw bad(`No permission covers ${amount} on ${on.kind} ${on.id}: ask the person (spend_propose).`, 403);
    p.charges = [...(p.charges || []), { at: now.toISOString(), amount, what: String(what).slice(0, 200) }];
    if (!p.permanent) p.state = 'used';
    return p;
  });
}

/** The permissions `actor` may see: their own; an admin's, everyone's. Newest first. */
function list(actor, d = store.load()) {
  return d.permissions.filter(p => isAdmin(actor) || p.personId === actor?.id)
    .map(p => ({ ...p, left: left(p) })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The permissions part of the agent's spending line, or ''. */
function describe(personId, d = store.load()) {
  const mine = d.permissions.filter(p => p.personId === personId);
  const active = mine.filter(p => p.state === 'active'), waiting = mine.filter(p => p.state === 'proposed').length;
  if (!active.length && !waiting) return '';
  const each = active.map(p => `up to ${p.upTo} ${p.currency} ${p.permanent ? 'a month' : 'once'} on ${p.on.kind} ${p.on.id} (${left(p)} left)`);
  return `spending permissions: ${each.join('; ') || 'none active'}${waiting ? `; ${waiting} proposal${waiting === 1 ? '' : 's'} waiting for the person` : ''}`;
}

module.exports = { KINDS, normalize, mayAllow, allowed, create, propose, accept, decline, revoke, left, covers, consume, list, describe };
