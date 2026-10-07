'use strict';

/**
 * A token ceiling that halts (TODO.md, "A budget ceiling that halts, not only
 * warns").
 *
 * `maxSteps` bounds one turn and `autoWakesPerHour` the turns the panel starts
 * by itself; nothing bounded a day, so a loop across many turns — the case the
 * usage ledger was built to make visible — could not be stopped by it.
 * `tokensPerDay` (0 = no ceiling, the default) is checked when a turn starts,
 * against every model call in the ledger over the last 24 hours: past it, the
 * turn is refused and says why. A turn already running is never cut off
 * mid-flight — the ceiling decides whether the next one starts.
 *
 * It is also where a person's spending budget is checked (spending/, CONSTITUTION S12): one place refuses a turn for
 * what was spent, the harness's day first and then the budget of the conversation's person, which is opt-in.
 */
const usage = require('../usage');

/** The ledger's last 24 hours against the ceiling: { used, limit, over }. */
async function state(p, now = new Date()) {
  const limit = Math.max(0, Math.floor(Number(p?.tokensPerDay) || 0));
  if (!limit) return { used: null, limit: 0, over: false };
  const { total } = await usage.summary({ days: 1, by: 'kind', now });
  const used = total.prompt + total.completion;
  return { used, limit, over: used >= limit };
}

/**
 * The person's budget line, or a refusal. At their own budget, on a turn that is theirs (`ask`, from spending/over.js),
 * they are asked once whether to go over it for this turn (TODO P1.6): any other budget reached still refuses, unasked.
 */
async function budgetLine({ person, sessionId, ask }, now) {
  const spending = require('../../spending');
  try { return await spending.beforeTurn({ person, sessionId }, now); } catch (e) {
    if (!ask || e.code !== 'budget_reached' || e.over?.from !== 'own' || e.personId !== person?.id) throw e;
    await spending.beforeTurn({ person, sessionId, overOwn: true }, now);   // an admin's, a leader's or the level's: refused here
    const over = require('../../spending/over');
    const decision = await ask(e);
    if (decision !== 'once') throw over.declined(e, decision);
    over.record(e, person, sessionId);
    return spending.beforeTurn({ person, sessionId, overOwn: true }, now);
  }
}

/**
 * Returns `p` when a turn may start — with `_spending`, the line its agent reads, when its person has a budget or a
 * spending permission; throws, saying why, when the ceiling or the person's budget is reached (or, at their own
 * budget, when they did not choose to go over it).
 */
async function check(p, now = new Date(), { person = null, sessionId = null, ask = null } = {}) {
  const s = await state(p, now);
  if (!s.over) {
    const line = await budgetLine({ person, sessionId, ask }, now);
    return line ? { ...p, _spending: line } : p;
  }
  throw Object.assign(new Error(`Not started: the model calls of the last 24 hours used ${s.used} tokens, and the `
    + `daily ceiling is ${s.limit} (harness setting "Tokens per day", harness.config.doca.tokensPerDay). `
    + 'Raise it or set it to 0 in the harness ⚙ panel, or wait for older calls to leave the 24-hour window.'),
  { status: 429, code: 'token_ceiling' });
}

module.exports = { state, check };
