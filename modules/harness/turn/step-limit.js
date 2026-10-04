'use strict';

/**
 * The sentence a turn ends with when it runs out of steps.
 *
 * Name the limit that actually stopped it. A specialist's step cap comes from
 * its own definition file, so sending the user to the panel's harness settings
 * would be sending them somewhere that changes nothing — which is charter rule
 * 12 broken by the code that enforces it.
 */
function stepLimitNote(profile, maxSteps) {
  return profile
    ? `Stopped after ${maxSteps} tool steps without a final answer — that is this specialist's own `
      + `limit, "maxSteps" in the ${profile.id} agent definition, not the model's and not the panel's. `
      + 'Raise it there, or give it a narrower errand.'
    : `Stopped after ${maxSteps} tool steps without a final answer — that is this panel's own `
      + 'limit (harness.config.doca.maxSteps), not the model\'s. Raise "Max tool steps" in the harness '
      + 'settings, or ask again more narrowly.';
}

module.exports = { stepLimitNote };
