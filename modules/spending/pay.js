'use strict';

/**
 * Paying — a stub, on purpose (docs/design/spending.md §5). No payment method can be linked yet: linking one is a
 * payment provider's tokenised method (never a card number in DOCA), kept in keys/ and used by the hub, never read by
 * the agent (S4), and it waits for its own release. Until then the path a purchase takes exists end to end except the
 * payment: a covering permission is required, and then the charge is refused because nothing is linked.
 */
const permissions = require('./permissions');

const NOT_LINKED = 'No payment method is linked, so nothing can be bought yet — say what it costs and where, and the person pays for it themselves.';

/** Whether a payment method is linked: never, in this release. */
const linked = () => false;

/** What the Spending page and the agent are told about it. */
const status = () => ({ linked: linked(), note: NOT_LINKED });

/**
 * Buy `amount` on `on` for `person`. Refuses without a covering permission (the agent asks: spend_propose), and —
 * today — always after that, since nothing is linked. When linking exists: consume the permission, then charge.
 */
function charge(person, on, amount) {
  if (!permissions.covers(person?.id, on, amount))
    throw Object.assign(new Error(`No permission covers ${amount} on ${on?.kind} ${on?.id}: ask the person first (spend_propose).`), { status: 403, code: 'not_permitted' });
  throw Object.assign(new Error(NOT_LINKED), { status: 409, code: 'no_payment_method' });
}

module.exports = { linked, status, charge, NOT_LINKED };
