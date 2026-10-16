'use strict';

/**
 * How far a job is, worked out from its plan (improvement B, 2026-10-16): steps done of steps, cancelled ones left out,
 * and which step is running now. A step whose contract carries a check is done only once the check held
 * (toolbox/work.js runs it before marking), so the percentage is checked contracts, plus the steps without a check that
 * were marked done on the agent's word. Mechanical — read from the plan, never written by an agent or a model — and
 * drawn in the Workstream, on a project's chat tabs and in the status column (public/js/work-progress.js), and sent to
 * devices on `agent.mission` as `plan` and `progress` (workview.js), the shape a specialist's mission already has.
 * The last verdict of each step's check is kept on the plan (`checks`), so a failing check shows with its reason.
 */
const short = (t, n) => String(t || '').slice(0, n);

function of(plan) {
  if (!Array.isArray(plan?.steps) || !plan.steps.length) return null;
  const live = plan.steps.map((title, i) => ({ n: i + 1, title, state: plan.progress?.[i + 1] || 'queued' })).filter(s => s.state !== 'cancelled');
  if (!live.length) return null;
  const done = live.filter(s => s.state === 'done');
  const run = live.find(s => s.state === 'running');
  const failing = live.filter(s => s.state !== 'done' && plan.checks?.[s.n] && !plan.checks[s.n].ok).pop();
  return { done: done.length, total: live.length, percent: Math.round(100 * done.length / live.length),
    checked: done.filter(s => plan.contracts?.[s.n - 1]?.check).length,
    running: run ? { step: run.n, title: short(run.title, 160) } : null,
    blocked: live.filter(s => s.state === 'blocked').length,
    failing: failing ? { step: failing.n, why: short(plan.checks[failing.n].why, 300) } : null,
    fulfilled: !!plan.fulfilledAt };
}

/** A conversation's progress: its own plan, else the specialist's checklist when it is a mission's. */
function forSession(s) {
  const own = of(s?.plan);
  if (own) return own;
  try { const missions = require('../agents/missions'); return missions.planProgress(missions.forSession(s?.id)?.plan); } catch { return null; }
}

/** The plan as a device draws a mission's checklist (PROTOCOL §11.4): at most 12 items, done|running|queued|failed. */
function devicePlan(plan) {
  if (!Array.isArray(plan?.steps) || !plan.steps.length) return undefined;
  const items = plan.steps.map((title, i) => ({ title: short(title, 120), state: plan.progress?.[i + 1] || 'queued' }))
    .filter(x => x.state !== 'cancelled')
    .map(x => ({ title: x.title, state: x.state === 'blocked' ? 'queued' : x.state }));
  return items.length ? items.slice(0, 12) : undefined;
}

/** Pages showing progress redraw (live topic `progress`, heard by whoever may open the conversation). */
function changed(sessionId) {
  try { require('../live').changed('progress', sessionId, 'plan'); } catch { /* the feed is a nicety */ }
}

/** Keep the verdict of a step's check on its plan: the bar shows a failing one with why. */
function noteCheck(sessionId, step, verdict) {
  const memory = require('./memory'), s = memory.getSession(sessionId);
  if (!s?.plan) return;
  memory.updateSession(sessionId, { plan: { ...s.plan, checks: { ...s.plan.checks, [step]: { ok: !!verdict.ok, why: short(verdict.why, 600), at: new Date().toISOString() } } } });
  changed(sessionId);
}

const ENDED = ['stopped', 'dropped'];
const projectOf = id => { try { return require('../projects/store').forSession(id)?.id || null; } catch { return null; } };
const RECENT_MS = 24 * 3600e3, DONE_SHOWN_MS = 15 * 60e3;

/** The jobs with a plan that a person may see, running first: what the status column, Workstream and Projects draw. */
function active(person, { now = Date.now(), limit = 12 } = {}) {
  const access = require('./session-access'), memory = require('./memory'), agent = require('./agent');
  const rows = [];
  for (const s of memory.listSessions().sessions) {
    if (s.archivedAt || s.kind === 'orchestrator' || !s.plan) continue;
    const p = of(s.plan);
    if (!p || ['draft', 'proposed', 'rejected'].includes(s.plan.state) && !Object.keys(s.plan.progress || {}).length) continue;
    const running = agent.isRunning(s.id);
    if (!running && ENDED.includes(s.job?.state)) continue;
    if (now - Date.parse(s.updatedAt || 0) > RECENT_MS) continue;
    if (p.fulfilled && now - Date.parse(s.plan.fulfilledAt) > DONE_SHOWN_MS) continue;
    if (person && !access.mayUse(person, s.id)) continue;
    rows.push({ id: s.id, kind: 'work', title: short(s.plan.title || s.title, 120), running, projectId: projectOf(s.id), progress: p, updatedAt: s.updatedAt });
  }
  try {
    const missions = require('../agents/missions');
    for (const m of missions.list({ state: 'running', limit: 50 })) {
      const mp = missions.planProgress(m.plan);
      const at = (m.plan || []).findIndex(i => i.state === 'running');
      if (!mp || !m.sessionId || (person && !access.mayUse(person, m.sessionId))) continue;
      rows.push({ id: m.sessionId, missionId: m.id, kind: 'mission', title: short(m.label || m.task, 120), running: true, projectId: projectOf(m.sessionId),
        progress: { ...mp, running: at < 0 ? null : { step: at + 1, title: short(m.plan[at].title, 160) }, checked: 0, blocked: 0, failing: null, fulfilled: false }, updatedAt: m.updatedAt || m.startedAt });
    }
  } catch { /* specialists off */ }
  return rows.sort((a, b) => Number(b.running) - Number(a.running) || String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, limit);
}

function mount(app) {
  app.get('/api/harness/progress', (req, res) => {
    try { res.json({ jobs: active(require('./turn/client').dashboardClient(req).user) }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { of, forSession, devicePlan, changed, noteCheck, active, mount };
