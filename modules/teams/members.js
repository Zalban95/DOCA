'use strict';

/**
 * Who is on a team (asked 2026-10-09: "a small section that lists the members of a team working within it"), read
 * from records only (AGENTS.md, "Visibility is mechanical"): the leader — the conversation that made it — the people
 * who started it (whose that conversation is: session-access.ownerOf, named from their account), and each specialist
 * (or work chat) working a task, with its task, state, step of its budget, and where it works (place.js: its own
 * worktree's branch, or the shared folder). One member per task: a retry is the same member trying again.
 */
const board = require('./board');

const name = id => { try { const u = require('../auth/store').userById(id); return u ? (u.name || u.email || id) : null; } catch { return null; } };

function members(team, views) {
  const memory = require('../harness/memory');
  const lead = memory.getSession(team.by);
  const owner = (() => { try { return require('../harness/session-access').ownerOf(team.by); } catch { return null; } })();
  const people = owner ? [{ id: owner, name: name(owner) || 'a person' }] : [];
  const leader = { sessionId: team.by, title: lead?.title || 'a conversation',
    kind: lead?.kind === 'orchestrator' ? 'Orchestrator' : lead?.kind === 'work' ? 'work chat' : 'conversation' };
  const label = agent => (agent === 'work' ? 'Work chat' : require('../agents/registry').get(agent)?.label || agent);
  const missions = require('../agents/missions');
  const specialists = views.map(v => {
    const m = v.missionId ? missions.get(v.missionId) : null;
    return { task: v.id, taskTitle: v.title, agent: v.agent, name: label(v.agent), state: v.state, says: board.say(v),
      percent: v.percent, ...(v.budget ? { step: v.step || 0, budget: v.budget } : {}),
      sessionId: m?.sessionId || v.sessionId || null, missionId: v.missionId || null,
      branch: v.place?.branch || null, root: v.place?.root || null, tries: v.tries || 0 };
  });
  return { leader, people, specialists };
}

module.exports = { members };
