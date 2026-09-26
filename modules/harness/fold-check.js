'use strict';

/**
 * A saved config that cannot fold (TODO.md, harness gaps §5).
 *
 * Folding fires at the lower of `compactTokens` and `compactAt`% of a declared
 * window (budget.compactionFor). Both are typed in by hand, and this panel once
 * ran with a 1M window and `compactTokens` at 500 000: past where turns end, so
 * nothing ever folded and every turn carried the whole conversation. Nothing
 * said so. This says so — in the ⚙ panel and in the agent's "# Your limits",
 * since the agent is the one that can propose the fix.
 */
const budget = require('./budget');

const LATE = 200000;   // tokens of prompt: few conversations get here, so a trigger beyond it rarely fires

/** Why this config's token folding will not (or will barely ever) fire, or null. */
function warning(p) {
  const trigger = budget.compactionFor(p || {});
  if (!trigger) return null;
  const window = budget.windowFor(p);
  const which = `harness.config.doca.${trigger.setting}`;
  if (window && trigger.at >= window)
    return `Token folding can never fire: it starts at ${trigger.at} tokens (${which}), at or past the ${window}-token `
      + 'context window, so the window fills first. Lower compactTokens or compactAt.';
  if (trigger.at > LATE)
    return `Token folding starts only at ${trigger.at} tokens of prompt (${which}) — later than most conversations `
      + `ever get, so in practice nothing folds and every step carries the whole conversation. Below ${LATE} is usual; `
      + 'the default is 40000.';
  return null;
}

module.exports = { warning, LATE };
