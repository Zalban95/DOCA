'use strict';
/**
 * Long work in Manual mode says what Manual costs, and offers Auto (the owner, 2026-10-12: "in manual, if the agent is
 * asked for a long job or teams: should we switch to auto mode? If the answer is no, they explain what the price of
 * manual mode is, conversationally, briefly"). Mechanical: a fixed sentence added to the job's acknowledgement (fork.js)
 * and to a team's creation, so no model step is spent on it; the switch itself stays the person's (the approval mode
 * is never the agent's to change — approval.js, guarded by the password).
 */

/** The approval mode this conversation runs under (its own Auto/Manual, else the panel's). */
function mode(sessionId) {
  try {
    const approval = require('./approval');
    return require('./modes').approvalMode(sessionId, approval.settings().mode);
  } catch { return 'auto'; }
}

/** '' unless the conversation is in Manual; else one or two sentences: the question, and the price, said at once. */
function note(sessionId, { spoken = false } = {}) {
  if (mode(sessionId) !== 'manual') return '';
  return spoken
    ? ' You are in Manual, so it will stop for your yes at each step that matters. Want Auto for this? You switch it on the chat.'
    : ' You are in **Manual**: it will stop for your yes at each action that matters, so it takes longer and needs you nearby. '
      + 'Switch this conversation to **Auto** (⚡ above the chat) to let it run; staying in Manual is fine too — it waits for you.';
}

module.exports = { note, mode };
