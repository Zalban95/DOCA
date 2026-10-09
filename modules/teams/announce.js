'use strict';

/**
 * Saying what a team's board did — mechanically, in fixed words filled with the board's data (AGENTS.md, "Visibility is
 * mechanical"): the live feed's `teams` topic for open pages, `agent.team` for the person's devices (PROTOCOL §11.4),
 * a Workstream line per change of a task's state, the team document written again, and one report to the leader when
 * the team ends. No model and no agent writes any of it.
 */
const board = require('./board');

/** The device event's payload: the board as a client draws it (teams/openapi.js holds the schema). */
function payload(team, views) {
  const doc = team.doc?.name ? { name: team.doc.name, kind: 'doc', mime: 'text/markdown', url: `/api/v1/harness/images/${encodeURIComponent(team.doc.name)}` } : undefined;
  return {
    teamId: team.id, title: team.title, goal: team.goal ? String(team.goal).slice(0, 200) : undefined, state: team.state,
    progress: team.progress || board.summary(team, views).progress,
    keepGoing: { on: !!team.loop?.on, rounds: team.loop?.rounds || 0, maxRounds: require('./engine').maxRounds(team) },
    tasks: views.map(v => ({ id: v.id, title: v.title, agent: v.agent, state: v.state, percent: v.percent, after: v.after,
      ...(v.step !== undefined && v.budget ? { step: v.step, budget: v.budget } : {}), ...(v.waitingOn ? { waitingOn: v.waitingOn } : {}),
      ...(v.missionId ? { missionId: v.missionId } : {}), ...(v.why ? { why: String(v.why).slice(0, 200) } : {}),
      ...(v.contract?.done ? { doneWhen: v.contract.done } : {}) })),
    notes: (team.notes || []).length, doc, startedAt: team.createdAt, endedAt: team.endedAt || undefined,
    archivedAt: team.archivedAt || undefined,
  };
}

/** To every device whose person may open the leader's conversation: durable when a state changed, else a tick. */
function devices(team, views, { durable = true, quiet = false } = {}) {
  try {
    const devs = require('../api-v1/devices'), bus = require('../api-v1/bus'), access = require('../harness/session-access');
    const body = payload(team, views);
    for (const d of devs.list()) {
      if (!access.hears(d, team.by)) continue;
      bus.publish(d.id, 'agent.team', durable ? { ...body, ...(quiet ? { quiet: true } : require('../presence').quietFlag(d.userId)) } : body,
        durable ? undefined : { cls: 'ephemeral' });
    }
  } catch { /* a team's bookkeeping never breaks the team */ }
}

/** A Workstream line about a team (machines' lines are the model: fixed words, data filled in). */
function line(team, text) {
  try { require('../workstream').team(team, text); } catch { /* no Workstream open */ }
}

/** After an advance: redraw, tell the devices, write the document, and say each change once. */
function changed(team, views, { changed = [], ended = false, title = id => id, force = false } = {}) {
  require('../live').changed('teams', team.id, team.state, { sessionId: team.by });
  const moved = force || ended || changed.length > 0;   // a step tick moves only a percentage: no document, an ephemeral event
  devices(team, views, { durable: moved });
  for (const v of changed) line(team, `${v.id} "${v.title}" (${v.agent}): ${board.say(v, title)}`);
  if (moved) try { require('./doc').write(team, views); } catch (e) { console.warn(`[teams] ${team.id} document: ${e.message}`); }
  if (ended) {
    const p = team.progress;
    const text = `Team "${team.title}" ${team.state}: ${p.done} of ${p.total} tasks done (${p.percent}%).`
      + `${views.filter(v => v.state !== 'done').map(v => ` ${v.id} ${board.say(v, title)}.`).join('')}`
      + `${team.doc?.name ? ` Its document: ${team.doc.project || team.doc.name}.` : ''}`;
    line(team, text);
    // To the leader itself (organization.report sends upward, to the leader's own leaders): an unread report, read in its next step.
    try {
      const note = { id: require('crypto').randomUUID(), from: team.id, type: 'team', text: text.slice(0, 4000), by: 'panel', at: new Date().toISOString() };
      require('../harness/memory').updateSessions([team.by], row => ({ reports: [...(row.reports || []), note] }));
    } catch { /* the leader is gone */ }
  }
}

module.exports = { payload, devices, line, changed };
