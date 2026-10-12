'use strict';

/**
 * Which of a person's own accounts a turn may use (the owner, 2026-10-12): only that person's — on their turns and by
 * the agents working for them (a work chat, a mission up the same conversation: session-access.ownerOf) — never another
 * person's, whoever asks; only one whose check "the Orchestrator may use it" is on; and only a provider the person's
 * level allots (auth/allot.js kind `account`, by provider; a level naming none keeps every provider).
 */
const accounts = require('./store');

/** The person a turn works for: the one on it, else the person whose conversation it is. */
function personOf(ctx = {}) {
  if (ctx.user?.id) return ctx.user;
  const id = ctx.sessionId ? require('../harness/session-access').ownerOf(ctx.sessionId) : null;
  if (!id) return null;
  return require('../harness/turn/client').personById({ id, orgId: require('../auth/store').defaultOrg()?.id || null }) || { id };
}

/** A leader's turn (the person's own, the Orchestrator, a work chat) — not a specialist on a mission. */
const leader = ctx => !ctx.profile || ['orchestrator', 'work'].includes(ctx.profile.level);

const name = r => r.label || r.account || r.provider;
const matches = (r, want) => { const w = String(want || '').toLowerCase(); return r.id === want || [r.label, r.account, r.provider].some(x => x && String(x).toLowerCase() === w); };

/** The accounts the agents may use for this person, or { why } when there are none. */
function forAgents(person) {
  if (!person?.id) return { list: [], why: 'There is no person on this turn, so there are no accounts of theirs to use.' };
  const mine = accounts.list(person.id);
  if (!mine.length) return { list: [], why: 'This person has connected no Google or Microsoft 365 account yet: they connect their own in Field → Connectors → Your accounts.' };
  const allot = require('../auth/allot');
  const ok = mine.filter(r => r.orchestrator !== false && allot.uses(person, 'account', r.provider));
  if (!ok.length) return { list: [], why: `Their account${mine.length > 1 ? 's are' : ' is'} connected, but the check "the Orchestrator may use it" is off`
    + ' (or their level does not allot that provider): they turn it on in Field → Connectors → Your accounts.' };
  return { list: ok };
}

/**
 * The account a call names, among those the agents may use — or the only one there is. `several: true` returns them
 * all when none is named (reading across accounts).
 */
function pick(ctx, want, { several = false } = {}) {
  const person = personOf(ctx);
  const { list, why } = forAgents(person);
  if (!list.length) return { why, person };
  if (want) {
    const hit = list.find(r => matches(r, want));
    return hit ? { list: [hit], person } : { why: `No account "${want}" the agents may use; theirs: ${list.map(name).join(', ')}.`, person };
  }
  if (several || list.length === 1) return { list, person };
  return { why: `They have ${list.length} accounts — say which with account: ${list.map(r => `"${name(r)}"`).join(', ')}.`, person };
}

module.exports = { personOf, leader, forAgents, pick, name };
