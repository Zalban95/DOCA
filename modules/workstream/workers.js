'use strict';

/**
 * Who is working now, and how far each is (asked 2026-10-17: "which agent is editing what … the estimated percentage
 * if they have one, otherwise the overall work done reported mechanically … both the internal ones, which can be more
 * detailed, and the external processes"). The Workstream's "Working now" strip, one row per worker:
 *
 *   doca      a conversation of this hub running a turn now: its title (a specialist's errand by its label), its plan
 *             as done of total with the step running (harness/plan-progress.js — a step with a check counts only once
 *             the check held), the steps of the turn so far, and the last thing it did on the Workstream
 *   outside   another agent's session on this machine (outside-agents/sessions.js, while that is switched on): its
 *             own title and repository, its own todo list or plan as done of total when it keeps one, else what it did
 *   process   a process of note outside the agents (a build, a test run, an emulator: workstream/outside.js): what it is,
 *             where it works and for how long
 *
 * Mechanical, all of it: plans, records and the process table in fixed words. No model is asked and no agent posts.
 */
const MAX = 24;

const title = id => { try { return require('../harness/memory').getSession(id)?.title || id; } catch { return id; } };

/** This hub's conversations running a turn now, each with its plan's progress and how far its turn has gone. */
function doca() {
  const out = [];
  let running = [];
  try { running = [...require('../harness/turn/lifecycle').running.keys()]; } catch { return out; }
  const memory = require('../harness/memory'), progress = require('../harness/plan-progress');
  for (const id of running) {
    const s = memory.getSession(id);
    if (!s) continue;
    let mission = null;
    try { mission = require('../agents/missions').forSession(id); } catch { /* specialists off */ }
    const run = (() => { try { return require('../harness/runs').forSession(id, 1)[0] || null; } catch { return null; } })();
    const last = require('./index').lastFor(id);
    out.push({
      kind: 'doca', id, name: mission ? `${mission.label || mission.agentId} · ${String(mission.task || '').slice(0, 80)}` : title(id),
      role: mission ? 'specialist' : s.kind === 'orchestrator' ? 'orchestrator' : s.kind === 'work' ? 'work chat' : 'conversation',
      progress: progress.forSession(s),
      activity: { steps: run?.steps ?? null, sinceMs: run?.startedAt ? Date.now() - Date.parse(run.startedAt) : null, lastAgoMs: last ? Date.now() - last.at : null },
      now: last ? `${last.kind === 'command' ? '' : `${last.kind}: `}${String(last.text).slice(0, 200)}` : '',
    });
  }
  return out;
}

/** Processes of note outside the agents: what each is, where, for how long (the Workstream's own reading). */
async function processes() {
  const ws = require('./outside');
  const t = await ws.table().catch(() => null);
  if (!t) return [];
  const out = [];
  for (const { p, k } of ws.notableNow(t)) {
    if (k.kind === 'agent') continue;   // an agent's session is its own row, from its record (when that is on)
    out.push({ kind: 'process', id: `pid:${p.pid}`, name: k.label || k.kind, role: k.kind, where: await ws.whereOf(p, {}).catch(() => null),
      activity: { sinceMs: p.startedAt ? Date.now() - p.startedAt : null }, progress: null, now: '' });
  }
  return out;
}

/** Everyone working now: this hub's agents first, then the agents outside, then the processes. */
async function list() {
  let outside = [];
  try { outside = require('../outside-agents/sessions').list(); } catch { /* not switched on */ }
  return [...doca(), ...outside, ...(await processes())].slice(0, MAX);
}

module.exports = { list, doca, processes };
