'use strict';

/**
 * Tools a turn does not hold because of a switch or of who the turn is for — each with why, so the panel's
 * roster (tool-roster.js) and the turn (prompt.js disabledFor) cannot disagree (audit 2026-10-06, aw 4, 15;
 * coh F6–F7; TODO B3). `tools.schemas()` still drops the switch-driven ones for a caller with no profile.
 */

/** Off for everyone while a switch is off. */
function switches() {
  const out = [];
  // Not in this hive's licence: absent, like a tool that was never built here (license/gate.js toolOn).
  const gate = require('../../license/gate');
  for (const t of require('../tools').TOOLS) if (!gate.toolOn(t.name)) out.push({ name: t.name, why: 'not in this hive\'s licence (Settings → System → Licence)' });
  if (!require('../../agents/registry').enabled())
    for (const name of ['agent_dispatch', 'agent_results', 'agent_resume', 'permission_grant', 'team'])
      out.push({ name, why: 'specialists are switched off (Settings → Harness)' });
  if (!require('../../computers/look').on()) out.push({ name: 'computer_look', why: 'the vision pass is off, or no vision model is set' });
  if (!require('../../system-one').on()) out.push({ name: 'computer_next', why: 'the System 1 model experiment is off' });
  if (!require('../../vnc-targets').any())
    for (const name of ['vnc_look', 'vnc_input']) out.push({ name, why: 'no VNC screen is added (Machines → VNC)' });
  if (!require('../../api-services/store').list().length) out.push({ name: 'service', why: 'no API service is set up (Field → Connectors → API services)' });
  if (!require('../../scout').on()) out.push({ name: 'model_scout', why: 'the model scout experiment is off' });
  if (!require('../../library/indexer').on()) out.push({ name: 'library_search', why: 'the Library experiment is off, or no embedding model is set for it' });
  if (require('./tool-tiers').mode() === 'all') out.push({ name: 'tools_more', why: 'every tool is sent in full (harness.config.doca.toolsLoading: all)' });
  // An old name kept so old transcripts and recipes still run (tools.call maps it); never offered.
  out.push({ name: 'show_image', why: 'an old name for show_media' });
  return out;
}

/**
 * Why a tool this turn does not hold is off, and the way that is open instead — for a refused call and for tools_more,
 * which used to answer "Loaded" for a tool the turn could not call (the airlock's web tools, 2026-10-10: the agent
 * loaded web_search three times and was refused each time, never dispatching the researcher).
 */
function whyOff(name, profile = null) {
  const registry = require('../../agents/registry');
  if (registry.AIRLOCK_ONLY.includes(name) && registry.enabled() && !profile?.airlock)
    return 'the airlock: only the scout and the researcher read the web — dispatch one with agent_dispatch and act on its report';
  return switches().find(x => x.name === name)?.why || null;
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
  // A team's board (teams/): only a mission that is one of its tasks posts to it.
  let onTeam = false;
  try { onTeam = !!profile?.missionId && !!require('../../teams').forMission(profile.missionId); } catch { /* no team */ }
  if (!onTeam) out.push({ name: 'team_note', why: 'only a specialist working on a team\'s task posts to its board' });
  const computerTools = all.some(n => /^mcp__computer-/.test(n) && !notMine.includes(n));
  if (!computerTools) out.push({ name: 'computer_login', why: 'it signs in on a computer whose tools this turn holds, and it holds none' });
  return out;
}

module.exports = { whyOff, switches, off, MISSION_ONLY };
