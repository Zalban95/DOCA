# Spending with permission

CONSTITUTION S12 (2026-10-07): *"With a payment method linked, the product may buy a service the work needs — after
the person's permission. Spending has its own settings page, which the agent may also manage with the person's
permission; a permission the person asks to make permanent stays permanent; what a person may allow follows their
level. Nothing is spent unasked."* With S13 (budgets are allotted resources) and S14 (spending switches ask for the
password). TODO P1.6; experience.md §2 ("Is a payment method linked? → Ask permission once; then set it up").

The owner's words: "Money: a settings page, managed also by the agent with the user's permission. A permission can be
made permanent if asked. Anything is possible with the right level." And: limits and notices are opt-in — nothing is
imposed by default, and the owner's own limits are never lowered for token cost.

## 1. What can go wrong

Money spent by an agent is **outward and hard to reverse**: a purchase is a promise to somebody else, a refund is
their decision, and a subscription keeps charging after the conversation that started it is forgotten. So spending is
treated like the other outward acts (a submit, a login: `forced-asks.js`), only stricter.

| Threat | What stops it |
|---|---|
| The agent decides on its own to buy something "the work needs" | It can only **propose** a permission (`spend_propose`); a person accepts it, with their password (S14). Proposals never apply themselves — not in Unattended, not with `asked`. |
| Prompt injection: a page, mail or file tells the agent to buy, or to raise its budget | Same: a proposal is all it can make, and the card names what, how much and why. The person's password is a click the page cannot make. |
| The agent edits the record that says what it may spend | The rules live in `DATA_DIR/keys/spending.json`: the keys folder is protected from the agent's file tools (`paths.PROTECTED_DIRS`), and every route that changes them asks for the password (`auth/guarded.js`). `shell` remains the stated limit of one account, as for every key. |
| A permanent permission becomes an open cheque | A permission is **up to an amount**: once for a one-time permission (then it is used), per calendar month for a permanent one. |
| A person allows more than their level should | What a person may allow themselves is their level's `mayAllow` (Settings → Spending, per level; none for a level without host until an admin sets one). An admin may allow anything to anyone, like a grant (S13). |
| A specialist or a mission spends unwatched | `spend_propose` is in `registry.NEVER`: proposals have one owner, the conversation the person talks to. |
| Card numbers in DOCA | Never. See §4: a payment provider's tokenised method, used and never read (S4). |
| A member lowers the prices to escape a money budget | Prices are a host's (`/api/harness/usage/prices` is `host`), and once any money budget exists, changing them asks for the password. |

## 2. What is spent: tokens, read from the ledger

Every model call is already a row of the usage ledger (`harness/usage.js`): tokens, provider, model, conversation.
Money is the owner's price list applied when reading (`harness/prices.js`) — a model without a price costs nothing
known, and is counted as such ("N calls had no price"), never as 0.

A row belongs to **the person whose conversation it is** (`session-access.ownerOf`, through its parent chain, so a
mission's and a work chat's calls are their person's). Rows of no conversation (a one-off `ask`, a probe) are
"not anyone's". Attribution is read, not stored, so history from before this release is attributed too. Days and
months are UTC calendar days and months, like every timestamp here.

Settings → Spending shows, for the month chosen: your own spend today and this month, tokens and money, day by day;
and, for an admin, everybody's.

## 3. Budgets: opt-in, refused at the start of a turn

A budget is `{ tokensPerDay, tokensPerMonth, moneyPerDay, moneyPerMonth }`; 0 or absent is "no budget". **None
exists until somebody sets one.** Three places can set one, and the tightest of each field wins:

- **your own** — any person, for themselves (a person asking to be stopped at 5 € a month);
- **an admin's, for a person** — someone holding `users` (S13: the admin allocates budgets);
- **a level's** — the default for everyone at that level, set by an admin.

**The owner is bound only by a budget they set themselves**: a level's or another admin's never applies to the role
`owner`. So nothing an install does by default, and nothing another admin does, lowers the owner's limits.

Budgets are quantities, not things, so they are not `allot.js` grants (`use:<kind>:<id>` is a yes or a no); they live
beside the spending permissions in `keys/spending.json`, keyed by person and by level id. A team leader allotting
budgets to their own people (`delegates`) is the next step and is not built.

Enforcement reuses the one place a turn is refused for spending, `turn/ceiling.js`: before a turn starts, the day's
token ceiling (`tokensPerDay`, the harness's, unchanged) and then the budget of the conversation's person. At the
budget the turn is refused with a 429 `budget_reached` that says which budget, what was used, and who can raise it
(you, in Settings → Spending, for your own; an admin for theirs or a level's). A turn already running is never cut off
mid-flight. "Ask instead of refusing" waits for a way to ask that is not the turn itself.

The agent is told — one line in its per-step readings, only when its person has a budget or a permission:
`spending: budget …; used …; permissions …; no payment method is linked`. (The `# Your limits` block of
`budget.js` has not been sent to the model since ISSUES.md H-9 moved the per-step readings after the history; the
line goes where it is read.)

## 4. Spending permissions

A permission is a record: **the agent may spend up to X (currency) on Y for person P**, where Y is a `kind` —
`service` (a web API with a key), `provider` (a model provider's credit), `purchase` (anything else bought) — and an
id (`hi3d.ai`, `openrouter`, `*`). One-time (used by the first purchase it covers) or permanent (kept; up to X each
calendar month).

- **Made by a person**: their own, within their level's `mayAllow`; or an admin, for anyone.
- **Proposed by the agent** (`spend_propose`): the record waits as `proposed` on the Spending page; the person
  accepts it — once, or "keep it" (permanent, when they ask) — with their password, or declines it (no password:
  saying no is always free). An existing permission that covers the request is said instead of asking again.
- **Revoked** by its person or an admin, with the password.

`spending/permissions.js` `covers()` and `consume()` are what a purchase will call.

## 5. Linking a payment method — designed, not built

No payment API is integrated in this slice; `spending/pay.js` is the stub, and `charge()` refuses with "no payment
method is linked" after checking the permission, so the path a purchase takes exists end to end except the payment.

When it is built:

- The method is a **payment provider's tokenised method** (Stripe's SetupIntent → PaymentMethod, or the provider's
  own issued virtual card with its own spending controls), set up in the provider's own page — never a card number
  typed into DOCA, never stored here.
- What DOCA keeps is the provider's customer and method ids and an API key, in `keys/` (0600, protected), used by the
  hub and never read by the agent (S4).
- A charge happens only through `pay.charge()`, which requires a covering permission and consumes it before calling
  the provider, records the charge (amount, what, who, the permission), and notifies the person's devices.
- Linking and unlinking ask for the password (`auth/guarded.js`, `/api/spending/*`).
- Where the provider offers per-card limits (virtual cards), each permanent permission maps to one, so the
  provider's own limit stands behind DOCA's.

## 6. Where it is

`modules/spending/` (store, spent, budgets, permissions, pay, routes), `harness/toolbox/spending.js`
(`spend_propose`), `public/js/settings/spending*.js`, `auth/guarded.js` (`/api/spending/*`, the prices route),
`test/spending.test.js`.
