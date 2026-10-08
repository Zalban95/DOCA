'use strict';

/**
 * Tools a turn does not hold because of a switch or of who the turn is for — each with why, so the panel's
 * roster (tool-roster.js) and the turn (prompt.js disabledFor) cannot disagree (audit 2026-10-06, aw 4, 15;
 * coh F6–F7; TODO B3). `tools.schemas()` still drops the switch-driven ones for a caller with no profile.
 */

/** Off for everyone while a switch is off. */
function switches() {
  const out = [];
  if (!require('../../agents/registry').enabled())
    for (const name of ['agent_dispatch', 'agent_results', 'agent_resume', 'permission_grant'])
      out.push({ name, why: 'specialists are switched off (Settings → Harness)' });
  if (!require('../../computers/look').on()) out.push({ name: 'computer_look', why: 'the vision pass is off, or no vision model is set' });
  if (!require('../../system-one').on()) out.push({ name: 'computer_next', why: 'the System 1 model experiment is off' });
  if (!require('../../scout').on()) out.push({ name: 'model_scout', why: 'the model scout experiment is off' });
  if (!require('../../experiments').on('toolTiers')) out.push({ name: 'tools_more', why: 'the tool tiers experiment is off' });
  // An old name kept so old transcripts and recipes still run (tools.call maps it); never offered.
  out.push({ name: 'show_image', why: 'an old name for show_media' });
  return out;
}

/** Only a mission (a specialist's turn) plans and reports this way. */
const MISSION_ONLY = ['mission_plan', 'scout_report'];

/**
 * Everything off for this turn by shape: the switches, the mission-only tools outside a mission, and
 * `computer_login` when the turn holds no computer's tools to sign in with (its refs come from them).
 */
function off(profile, all = [], notMine = []) {
  const out = switches();
  const mission = !!profile && profile.level !== 'orchestrator';
  if (!mission) for (const name of MISSION_ONLY) out.push({ name, why: 'only a specialist on a mission uses it' });
  const computerTools = all.some(n => /^mcp__computer-/.test(n) && !notMine.includes(n));
  if (!computerTools) out.push({ name: 'computer_login', why: 'it signs in on a computer whose tools this turn holds, and it holds none' });
  return out;
}

module.exports = { switches, off, MISSION_ONLY };
