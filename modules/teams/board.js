'use strict';

/**
 * A team's board, read mechanically (docs/design/teams.md; asked 2026-10-09): every task's state and percentage come
 * from its mission (or work chat) and its contract — never from text an agent wrote. Pure but for the lookups it is
 * handed, so the panel, the document, the devices and the tests all read one answer.
 *
 *   queued     nothing it waits on is unfinished; the hub dispatches it next
 *   waiting    a task it comes after is not done yet (`waitingOn`), or failed (`blockedBy`)
 *   running    its specialist works: step N of its budget, the percentage steps ÷ budget (at most 99)
 *   paused     a restart cut its mission off; it carries on, or its person is asked
 *   checking   the specialist finished; the hub checks its contract ("done when …")
 *   done       finished, and its contract holds — 100%
 *   failed     its mission failed, or it finished and its contract does not hold (`why`)
 *   stopped    a person stopped it (or the team)
 *
 * The team's percentage is tasks done ÷ tasks, every task weighing the same — said so wherever it is drawn.
 */

const STATES = ['queued', 'waiting', 'running', 'paused', 'checking', 'done', 'failed', 'stopped'];
const LIVE = new Set(['queued', 'running', 'paused', 'checking']);

/** A work chat's job state, as a task's (harness/organization.js FINAL, stopped-work.js). */
function fromJob(s) {
  const job = s?.job || {};
  if (job.state === 'done') return 'finished';
  if (['failed', 'blocked', 'question'].includes(job.state)) return 'failed';
  if (['stopped', 'dropped'].includes(job.state)) return 'cancelled';
  return 'running';
}

/**
 * One task as it stands. `look.mission(id)` and `look.session(id)` return the row or null; `look.budget(agentId)` the
 * specialist's step budget. `doneIds` is the set of task ids already done (a dependency is met only by done).
 */
function task(t, { look, byId = new Map() } = {}) {
  const base = { id: t.id, title: t.title, agent: t.agent, after: t.after || [], missionId: t.missionId || null,
    sessionId: t.sessionId || null, contract: t.contract || null, tries: (t.tries || []).length };
  if (t.stoppedAt) return { ...base, state: 'stopped', percent: 0, why: t.stoppedWhy || 'stopped by a person' };
  if (!t.missionId && !t.sessionId) {
    if (t.error) return { ...base, state: 'failed', percent: 0, why: t.error };
    const deps = (t.after || []).map(id => byId.get(id)).filter(Boolean);
    const blockedBy = deps.filter(d => ['failed', 'stopped'].includes(d.state)).map(d => d.id);
    const waitingOn = deps.filter(d => d.state !== 'done').map(d => d.id);
    if (waitingOn.length) return { ...base, state: 'waiting', percent: 0, waitingOn, ...(blockedBy.length ? { blockedBy } : {}) };
    return { ...base, state: 'queued', percent: 0 };
  }
  let ran = null, step = 0, budget = null, progress = null, why = null;
  if (t.missionId) {
    const m = look.mission(t.missionId);
    if (!m) return { ...base, state: 'failed', percent: 0, why: 'its mission is gone' };
    ran = m.state === 'done' ? 'finished' : m.state; step = m.steps || 0; budget = look.budget(t.agent); why = m.error || null;
  } else {
    const s = look.session(t.sessionId);
    if (!s) return { ...base, state: 'failed', percent: 0, why: 'its work chat is gone' };
    ran = fromJob(s);
    const steps = s.plan?.steps?.length || 0;
    if (steps) progress = Object.values(s.plan.progress || {}).filter(x => x === 'done').length / steps;
    why = ran === 'failed' ? `its work chat reported ${s.job?.state}${s.brief ? `: ${String(s.brief).slice(0, 200)}` : ''}` : s.job?.stoppedWhy || null;
  }
  if (ran === 'running' || ran === 'paused') {
    const share = budget ? step / budget : progress;
    return { ...base, state: ran, step, budget, percent: share == null ? 0 : Math.min(99, Math.floor(100 * share)) };
  }
  if (ran === 'finished') {
    if (t.verdict?.ok) return { ...base, state: 'done', percent: 100, step, budget, why: t.verdict.why };
    if (t.verdict) return { ...base, state: 'failed', percent: 0, step, budget, why: `its contract does not hold: ${t.verdict.why}` };
    return { ...base, state: 'checking', percent: 99, step, budget };
  }
  if (ran === 'cancelled') return { ...base, state: 'stopped', percent: 0, why: why || 'stopped' };
  return { ...base, state: 'failed', percent: 0, why: why || 'its mission failed' };
}

/** Every task in order (dependencies read as they are decided, so a task after a done one is queued). */
function tasks(team, look) {
  const byId = new Map();
  const out = [];
  // Tasks come in any order; a dependency is read once it has been decided, a cycle reads as waiting.
  const pending = [...(team.tasks || [])];
  for (let guard = 0; pending.length && guard < 1000; guard++) {
    const i = pending.findIndex(t => (t.after || []).every(id => byId.has(id) || !(team.tasks || []).some(x => x.id === id)));
    const t = pending.splice(i < 0 ? 0 : i, 1)[0];
    const v = task(t, { look, byId });
    byId.set(t.id, v);
  }
  for (const t of team.tasks || []) out.push(byId.get(t.id));
  return out;
}

/** done / total and the percentage, every task counting the same; and the team's own state. */
function summary(team, views) {
  const total = views.length, done = views.filter(v => v.state === 'done').length;
  const percent = total ? Math.round(100 * done / total) : 0;
  let state = 'running';
  if (team.stoppedAt) state = 'stopped';
  else if (total && done === total) state = 'done';
  else if (!views.some(v => LIVE.has(v.state) || (v.state === 'waiting' && !v.blockedBy))) state = 'failed';
  return { state, progress: { done, total, percent } };
}

/** "running, step 12 of 30" — the one line a task's state is said in, everywhere. */
function say(v, title = id => id) {
  if (v.state === 'running' || v.state === 'paused') return `${v.state}${v.budget ? `, step ${v.step} of ${v.budget}` : ''}`;
  if (v.state === 'waiting') return `waiting on ${v.waitingOn.map(title).join(', ')}${v.blockedBy ? ` (${v.blockedBy.map(title).join(', ')} did not finish)` : ''}`;
  if (v.state === 'checking') return 'checking its contract';
  if (v.state === 'done') return v.contract?.check ? 'done — its contract holds' : v.contract ? 'done — on its specialist\'s word (no check)' : 'done';
  if (v.state === 'failed' || v.state === 'stopped') return `${v.state}${v.why ? ` — ${v.why}` : ''}`;
  return v.state;
}

module.exports = { STATES, LIVE, task, tasks, summary, say, fromJob };
