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
 */
const usage = require('../usage');

/** The ledger's last 24 hours against the ceiling: { used, limit, over }. */
function state(p, now = new Date()) {
  const limit = Math.max(0, Math.floor(Number(p?.tokensPerDay) || 0));
  if (!limit) return { used: null, limit: 0, over: false };
  const { total } = usage.summary({ days: 1, by: 'kind', now });
  const used = total.prompt + total.completion;
  return { used, limit, over: used >= limit };
}

/** Returns `p` when a turn may start; throws, saying why, when the ceiling is reached. */
function check(p, now = new Date()) {
  const s = state(p, now);
  if (!s.over) return p;
  throw Object.assign(new Error(`Not started: the model calls of the last 24 hours used ${s.used} tokens, and the `
    + `daily ceiling is ${s.limit} (harness setting "Tokens per day", harness.config.doca.tokensPerDay). `
    + 'Raise it or set it to 0 in the harness ⚙ panel, or wait for older calls to leave the 24-hour window.'),
  { status: 429, code: 'token_ceiling' });
}

module.exports = { state, check };
