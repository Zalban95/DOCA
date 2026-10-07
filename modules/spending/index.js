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

module.exports = { beforeTurn };
