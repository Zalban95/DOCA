'use strict';

/**
 * Spending (CONSTITUTION S12; docs/design/spending.md): what a turn needs from it — the check before it starts and the
 * one line its agent reads. The parts: store.js (the rules, in keys/), spent.js (the ledger per person), budgets.js,
 * permissions.js, pay.js (a stub until a payment method can be linked), routes.js (Settings → Spending).
 */
const budgets     = require('./budgets');
const permissions = require('./permissions');

/**
 * Before a turn: refuses it when its person's budget is reached (budgets.check), else returns the line its agent is
 * told — '' when the person has no budget and no permission, so nothing is added to a prompt otherwise.
 */
async function beforeTurn({ person, sessionId }, now = new Date()) {
  const who = budgets.personFor({ person, sessionId });
  if (!who?.id) return '';
  const s = await budgets.check(who, now);
  const parts = [budgets.describe(s), permissions.describe(who.id)].filter(Boolean);
  if (!parts.length) return '';
  return `spending (${who.name || 'your person'}'s, Settings → Spending): ${parts.join('; ')}. ${require('./pay').linked() ? '' : 'No payment method is linked, so nothing can be bought: '
    + 'to spend money, propose a permission with spend_propose and say what it costs.'}`.trim();
}

/**
 * A money budget counts in the owner's prices, and a model without one would be spent outside it (security review
 * 2026-10-07). So when the turn's person has a money budget, the model the turn will call must be priced: an unpriced
 * one refuses the turn, saying an admin prices it in Harness → Usage — refusing is clearer than guessing a price — and
 * unpriced rungs leave the fallback chain. Returns `p`, its chain narrowed when it had to be.
 */
function priced({ person, sessionId }, p) {
  const who = budgets.personFor({ person, sessionId });
  const b = who?.id ? budgets.effective(who) : null;
  if (!b || !(b.moneyPerDay || b.moneyPerMonth)) return p;
  const prices = require('../harness/prices'), list = prices.load();
  const has = (provider, model) => prices.cost({ key: `${provider}/${model}`, prompt: 0, completion: 0, cached: 0 }, list) !== null;
  if (!has(p.provider, p.model)) {
    throw Object.assign(new Error(`Not started: ${who.name || 'this person'} has a money budget, and ${p.provider}/${p.model} has no price, `
      + 'so what it costs could not be counted. An admin can price it in Harness → Usage (the "24h …" line beside the model), '
      + 'or choose a priced model.'),
    { status: 429, code: 'unpriced_model' });
  }
  const chain = (Array.isArray(p.fallbackChain) ? p.fallbackChain : []).filter(e => !e?.provider || has(e.provider, e.model || p.model));
  return chain.length === (p.fallbackChain || []).length ? p : { ...p, fallbackChain: chain };
}

module.exports = { beforeTurn, priced };
