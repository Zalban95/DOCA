'use strict';

/**
 * Who may make what below itself — the one depth rule every tool that creates reads (`work_chats create`, `team
 * create` and its work-chat tasks, `agent_dispatch`), through organization.js (asked 2026-10-14: "extend the right to
 * the projects chats as well, keeping count of the level, so the chat can spawn only teams and helpers that can not
 * spawn further down").
 *
 *   level 1  the Orchestrator (any person's own too)
 *   level 2  a conversation under it: a work chat it made, a person's chat, a project's chat tab
 *   level 3  what a level-2 conversation made: a specialist, or a work chat a project's chat made
 *
 * Work chats are made by the Orchestrator and by a project's own chat tabs (a level-2 conversation bound to a project,
 * `session.projectId`); teams and specialists by the Orchestrator and any level-2 conversation, as before. Level 3 makes
 * nothing: a specialist never delegates (registry.NEVER), and a work chat a project's chat made reports to that chat,
 * which makes what is needed. What a level-2 conversation makes is marked `level: 3` on its record when it is made, so
 * the rule never depends on walking a chain that a recipe run or a fork may have lengthened.
 */
const WHAT = { work: 'work chats', team: 'teams', dispatch: 'specialists' };

/** A conversation's level: 1, 2 or 3 (a session row as organization.session() gives it). */
function level(s) {
  if (s.kind === 'orchestrator') return 1;
  if (s.kind === 'specialist') return 3;
  return s.level === 3 ? 3 : 2;
}

/** Why `s` may not make `what` (work | team | dispatch), as a sentence naming its level; null when it may. */
function refusal(s, what) {
  const n = level(s);
  if (n === 1) return null;
  if (s.kind === 'specialist') return what === 'work'
    ? 'Only the Orchestrator and a project\'s chats create work chats; a specialist (level 3) makes nothing below itself — report to your leader.'
    : what === 'team' ? 'A specialist cannot make a team (level 3 makes nothing below itself). Report to your work leader.'
    : 'A specialist cannot delegate further (level 3 makes nothing below itself). Report to its work leader.';
  if (n === 3) return `This conversation is level 3 — it was made by a project's chat — and level 3 makes no ${WHAT[what]} of its own. `
    + 'Say what is needed in a work_chats report; the chat that made it creates it.';
  if (what === 'work' && !s.projectId) return 'Only the Orchestrator and a project\'s chats create work chats; this conversation (level 2) '
    + 'is not a project\'s chat — give the errand to a specialist (agent_dispatch) or a team, or ask the Orchestrator in a report.';
  return null;
}

/** Where what `s` makes goes: under the Orchestrator's default for the Orchestrator, else under `s`, one level down. */
function under(s) {
  return level(s) === 1 ? {} : { parentId: s.id, fields: { level: 3 } };
}

module.exports = { level, refusal, under };
