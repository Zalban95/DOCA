'use strict';

/**
 * Which models the people of this hub run on (the owner's decision of 2026-10-16; settings `peopleModels`, schema.js).
 * Three switches, any combination on:
 *
 *   same     people use the owner's models — the harness's model and fallbacks (on by default: today's behaviour)
 *   choose   people choose their own model for a conversation (the chat's picker; turn/choice.js) — admins always may
 *   assign   the owner assigns a model per person, per level, or to everyone but the owner; the most specific wins
 *            (admins assign to the people below them too, a slot of their own under the owner's: assign.js)
 *
 * For one turn: a person's own choice where allowed, else their assigned model, else the owner's when `same` is on,
 * else the turn is refused with what to do. The owner (role `owner`) is never a subject. An assigned model answers every
 * step (the mastermind/worker roles, turn/model-route.js, are the owner's arrangement, not theirs), and the harness's
 * order follows it as the fallback chain. All of it runs BEFORE auth/allot.narrowModel, which still holds the model to
 * what the person is allotted, and before spending's checks — so this sets or narrows, and never loosens either.
 */
const value = k => require('../settings-schema').value(`peopleModels.${k}`);
const host = p => require('../auth/rights').can(p?.role, 'host');

function policy() {
  return { same: value('same'), choose: value('choose'), assign: value('assign'), all: value('all'), levels: value('levels'), people: value('people') };
}

/** Whether the policy speaks for this person: someone signed in who is not the owner. */
const subject = person => !!person?.id && person.role !== 'owner';

/** `provider/model` → {provider, model}, or null (turn/model-route.js parse). */
const parse = v => require('../harness/turn/model-route').parse(v);

/** "Nothing assigned", said on purpose: distinct from "not set" (absent). */
const NONE = 'none';

/**
 * The first rule set for this person, as {provider, model, from, setBy, by} — or {none: true, from, setBy, by} when
 * that rule says "nothing assigned" — or null when no rule is set. The owner's decisions of 2026-10-16:
 *
 *   1. the owner's for the person      2. an admin's for the person      3. the owner's for their level
 *   4. an admin's for their level      5. the owner's for everyone but the owner
 *
 * The first rule that is SET decides — a model, or "nothing assigned" — and the rules after it never reach the person:
 * so the owner's wins where both set the same kind of rule, and "nothing assigned" for a person or a level shuts out
 * every broader assignment below it in this list. "Not set" (absent) passes to the next rule. With nothing assigned the
 * person runs as the policy says without one: their own choice where allowed, else the owner's models (`same`), else
 * none. The owner's rules count while the owner assigns (`assign`); an admin's always — an admin who does not want to
 * assign simply does not (no switch turns admins' assignments off: the owner's answer of 2026-10-16).
 */
function ruleFor(person, pol = policy()) {
  if (!subject(person)) return null;
  const as = require('./assign'), d = as.load(), admin = as.adminFor(person, d);
  const read = (raw, rest) => (raw === NONE ? { none: true, ...rest } : parse(raw) ? { ...parse(raw), ...rest } : null);
  const owner = (where, key, raw) => (pol.assign ? read(raw, { from: where === 'people' ? 'person' : where === 'levels' ? 'level' : 'everyone', setBy: 'owner', by: as.ownerBy(where, key, raw, d)?.by || null }) : null);
  const theirs = from => (admin?.from === from ? read(admin.model, { from, setBy: 'admin', by: admin.by, at: admin.at }) : null);
  return owner('people', person.id, pol.people?.[person.id]) || theirs('person')
    || owner('levels', person.role, pol.levels?.[person.role]) || theirs('level')
    || owner('all', null, pol.all) || null;
}

/** The model assigned to this person (ruleFor's, unless it says "nothing assigned"), or null. */
function assignedFor(person, pol = policy()) {
  const r = ruleFor(person, pol);
  return r && !r.none ? r : null;
}

/** May this person choose a conversation's model? */
// An admin (assign.js: users, or a team leader for models) always may — the owner's decision of 2026-10-16.
const mayChoose = (person, pol = policy()) => !subject(person) || host(person) || require('./assign').isAdmin(person) || pol.choose;

/** The person a conversation is for (its mark up its parents; harness/own-main.js), with their role. */
function ownerOf(sessionId) {
  const own = require('../harness/own-main');
  return own.personOfMark(own.markOf(sessionId));
}

/** Whether a conversation's chosen model counts: its person may choose, or the hub chose it (a stuck job's escalation). */
function choiceCounts(sessionId) {
  const s = require('../harness/memory').getSession(sessionId);
  if (!s?.modelChoice?.model || s.job?.escalated) return true;
  return mayChoose(ownerOf(sessionId));
}

const same = (a, b) => a && b && a.provider === b.provider && a.model === b.model;

/**
 * The turn's parameters under the policy. `p` has the conversation's choice applied already (turn/choice.js, which
 * drops a choice that does not count). Throws 403 `no_model` when the person has no model at all.
 */
function apply(p, { person, sessionId } = {}) {
  const who = person?.id ? person : ownerOf(sessionId);
  if (!subject(who)) return p;
  const pol = policy();
  if (p._choice?.model) return p;   // their own choice, already held to mayChoose by turn/choice.js
  const a = assignedFor(who, pol);
  if (a) {
    if (same(a, p)) return { ...p, _assigned: a.from };
    const order = require('../harness/turn/choice').order(p);
    const at = order.findIndex(e => same(e, a));
    return { ...p, provider: a.provider, model: a.model, contextWindow: at >= 0 ? order[at].contextWindow : 0,
      fallbackChain: order.filter(e => !same(e, a)), _assigned: a.from,
      _windowSetting: at > 0 ? `harness.config.doca.fallbackChain[${at - 1}].contextWindow` : at === 0 ? p._windowSetting : 'unknown for a model the owner assigned outside the harness order' };
  }
  if (pol.same) return p;
  throw Object.assign(new Error(`${who.name || 'This person'} has no model here: the owner has not assigned one`
    + `${pol.choose ? ' — choose one in the chat\'s model picker' : ''}. The owner sets it in Settings → Users → Models for people.`), { status: 403, code: 'no_model' });
}

/** Whether the owner's mastermind/worker routing applies to this person's turns: not when they run on a model of their own. */
function routes(person, session) {
  const who = person?.id ? person : session?.id ? ownerOf(session.id) : null;
  return !assignedFor(who);
}

/** For a device or a page: the model this person's turns start on, and why — never a secret. */
function effective(person) {
  const pol = policy();
  const p = require('../harness/turn/params').params();
  let used;
  try { used = apply(p, { person }); } catch (e) { return { provider: null, model: null, why: 'none', note: e.message, mayChoose: mayChoose(person, pol) }; }
  try { used = require('../auth/allot').narrowModel(used, person); } catch (e) { return { provider: null, model: null, why: 'not-allotted', note: e.message, mayChoose: mayChoose(person, pol) }; }
  const why = used._allotted ? 'allotted' : used._assigned ? `assigned:${used._assigned}` : 'owner';
  return { provider: used.provider || null, model: used.model || null, why, mayChoose: mayChoose(person, pol) };
}

module.exports = { NONE, policy, subject, ruleFor, assignedFor, mayChoose, choiceCounts, apply, routes, effective, ownerOf };
