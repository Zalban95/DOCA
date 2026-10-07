'use strict';

/**
 * The sentence a turn ends with when it runs out of steps.
 *
 * Name the limit that actually stopped it. A specialist's step cap comes from
 * its own definition file, so sending the user to the panel's harness settings
 * would be sending them somewhere that changes nothing — which is charter rule
 * 12 broken by the code that enforces it.
 */
function stepLimitNote(profile, maxSteps, verdict = null) {
  // With the triage on (experiment adaptiveLimits, turn/triage.js), the budget was this turn's, extended while it advanced.
  if (verdict) return `Stopped after ${maxSteps} tool steps without a final answer — this turn's budget, set by the triage `
    + `(${verdict.difficulty}; experiment adaptiveLimits) and extended while it advanced, `
    + (maxSteps >= verdict.ceiling ? `now at the owner's ceiling, limits.maxStepsCeiling (${verdict.ceiling}). Raise it there, ` : 'until its last steps stopped advancing. ')
    + 'or ask again more narrowly.';
  return profile
    ? `Stopped after ${maxSteps} tool steps without a final answer — that is this specialist's own `
      + `limit, "maxSteps" in the ${profile.id} agent definition, not the model's and not the panel's. `
      + 'Raise it there, or give it a narrower errand.'
    : `Stopped after ${maxSteps} tool steps without a final answer — that is this panel's own `
      + 'limit (harness.config.doca.maxSteps), not the model\'s. Raise "Max tool steps" in the harness '
      + 'settings, or ask again more narrowly.';
}

module.exports = { stepLimitNote };
