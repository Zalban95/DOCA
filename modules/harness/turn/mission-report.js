'use strict';

/**
 * A mission's last step is its report (self-test 2026-10-08, #6).
 *
 * A specialist's answer is the whole of what reaches its leader, and a mission that ran out of steps mid-call used to
 * end on the bare limit sentence: eight Tester missions in a row came back with "Stopped after 40 tool steps" and
 * nothing of what they had done, so the next round started by finding out again. So one step is kept back, the way
 * the Orchestrator's hand-off keeps its calls paired: at the last step no tools are offered, DOCA says why, and the
 * specialist writes its report; then a line tells the leader the mission ended on its limit, not because it finished.
 * Extending a turn that still advances (experiment adaptiveLimits, turn/extend.js) is decided first, as before.
 */
const { isMissionProfile } = require('./prompt');

/** Whether this step is kept for the report: a mission's last step, when it has more than one. */
const due = ({ profile, step, maxSteps }) => isMissionProfile(profile) && maxSteps > 1 && step === maxSteps;

/** Whose limit it is, by name and place (charter rule 12; turn/step-limit.js says the same for a turn). */
const whose = (profile, verdict) => verdict
  ? `this turn's budget (experiment adaptiveLimits, up to limits.maxStepsCeiling, ${verdict.ceiling})`
  : `"maxSteps" in the ${profile.id} agent definition (Agents → Harness → Specialists, ✎ beside it)`;

/** DOCA's row before the report step: no more tools, write the report now. */
function row(profile, maxSteps, verdict = null) {
  return { role: 'user', from: { id: null, name: 'DOCA', formFactor: 'hub' },
    content: `This is your last step: the mission's limit is ${maxSteps} steps, ${whose(profile, verdict)}. No tools run `
      + 'now. Write your report as your answer — it is all your leader gets: what you did, what you found (exact errors), '
      + 'where your files, screenshots and recordings are, and what is left undone and how far you got.' };
}

/** The line after the report, so the leader knows the mission stopped on its limit rather than finished. */
function ending(profile, maxSteps, verdict = null) {
  return `This mission ended on its step limit (${maxSteps}, ${whose(profile, verdict)}), not because the errand was `
    + 'done: the report above is what it did and what is left. Send it back with what is left, or raise the limit.';
}

module.exports = { due, row, ending };
