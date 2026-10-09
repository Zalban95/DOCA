'use strict';

/**
 * One record of how each turn went (docs/design/permissions.md §5): who it ran
 * for, how it ended, what it cost — written once when it starts and once when
 * it ends, and read by everything that shows it, so a mission and its
 * conversation can no longer tell two stories about the same turn (audit
 * 2026-10-04: Stop during a mission's last step left the conversation
 * 'cancelled' and the mission 'done').
 *
 * And the state compared to the plan, automatically: a mission that ends done
 * with plan items not done is flagged on the mission and reported to whoever
 * dispatched it. (A work chat's plan is checked when it reports done —
 * projects/finish.js.)
 */
const crypto = require('crypto');

const raw = () => require('../db').syncHandle();   // null with PostgreSQL: runs are not recorded there yet
const now = () => new Date().toISOString();

function begin({ id = null, kind = 'turn', sessionId = null, missionId = null, personId = null, detail = null } = {}) {
  const r = raw();
  if (!r) return null;
  id = id || `run_${crypto.randomBytes(6).toString('hex')}`;
  try {
    r.prepare("INSERT INTO runs (id, kind, session_id, mission_id, person_id, state, started_at, detail) VALUES (?,?,?,?,?,'running',?,?)")
      .run(id, kind, sessionId, missionId, personId, now(), detail ? JSON.stringify(detail) : null);
    return id;
  } catch { return null; }   // a record must never stop the work it records
}

/** How it ended: 'done', 'cancelled' or 'failed'. */
function end(id, { state, outcome = '', steps = null, tokens = null, detail } = {}) {
  if (!id) return;
  try {
    raw()?.prepare("UPDATE runs SET state = ?, outcome = ?, steps = ?, tokens = ?, ended_at = ?, detail = COALESCE(?, detail) WHERE tenant_id = 'local' AND id = ?")
      .run(state, String(outcome || '').slice(0, 600), steps, tokens, now(), detail === undefined ? null : JSON.stringify(detail), id);
  } catch { /* see begin */ }
}

/** Whom a run was on behalf of, once known (a mission's person is found above it). */
function person(id, personId) {
  if (!id || !personId) return;
  try { raw()?.prepare("UPDATE runs SET person_id = ? WHERE tenant_id = 'local' AND id = ?").run(personId, id); } catch { /* see begin */ }
}

const view = r => r && ({ id: r.id, kind: r.kind, sessionId: r.session_id, missionId: r.mission_id, personId: r.person_id, state: r.state,
  outcome: r.outcome || '', steps: r.steps, tokens: r.tokens, planCheck: r.plan_check ? JSON.parse(r.plan_check) : null,
  startedAt: r.started_at, endedAt: r.ended_at, detail: r.detail ? JSON.parse(r.detail) : null });

/** After a restart: a command job that was running is not any more — its process went with the old one. */
function recoverJobs() {
  try { raw()?.prepare("UPDATE runs SET state = 'failed', outcome = 'interrupted by a restart of the hub', ended_at = ? WHERE tenant_id = 'local' AND kind = 'job' AND state = 'running'").run(now()); } catch { /* see begin */ }
}

/**
 * After a restart: a turn that was running is not any more (deep test A, #11) — its promise went with the old process,
 * and Chronicle showed it "running" for ever, with no end and no tokens, while its mission carried on as a new run. It
 * is closed as stopped, saying why, with the steps and tokens its trace kept (null when it kept none). Called before
 * anything is carried on, so a run started since is never touched.
 */
function recoverTurns() {
  const r = raw();
  if (!r) return 0;
  try {
    const cut = r.prepare("SELECT id FROM runs WHERE tenant_id = 'local' AND kind != 'job' AND state = 'running'").all();
    for (const { id } of cut) {
      const spans = r.prepare("SELECT data FROM trace_spans WHERE tenant_id = 'local' AND run_id = ? AND kind = 'model'").all(id).map(x => JSON.parse(x.data || '{}'));
      const known = spans.filter(d => d.prompt != null || d.completion != null);
      const tokens = known.length ? known.reduce((n, d) => n + (Number(d.prompt) || 0) + (Number(d.completion) || 0), 0) : null;
      r.prepare("UPDATE runs SET state = 'cancelled', outcome = ?, steps = ?, tokens = ?, ended_at = ? WHERE tenant_id = 'local' AND id = ?")
        .run('interrupted: DOCA restarted (or switched version) while it ran; work that carries on does so in a new run', spans.length || null, tokens, now(), id);
    }
    return cut.length;
  } catch { return 0; }
}

/** Finished runs older than `days`, with their traces: gone (log-keep.js; `logs.runsRetainDays`). Returns how many. */
function prune(days) {
  const r = raw();
  if (!r || !(days > 0)) return 0;
  const before = new Date(Date.now() - days * 86400000).toISOString();
  try {
    r.prepare("DELETE FROM trace_spans WHERE tenant_id = 'local' AND run_id IN (SELECT id FROM runs WHERE tenant_id = 'local' AND state != 'running' AND started_at < ?)").run(before);
    return Number(r.prepare("DELETE FROM runs WHERE tenant_id = 'local' AND state != 'running' AND started_at < ?").run(before).changes || 0);
  } catch { return 0; }
}

function get(id) { return view(raw()?.prepare("SELECT * FROM runs WHERE tenant_id = 'local' AND id = ?").get(String(id))); }

function forSession(sessionId, limit = 20) {
  return (raw()?.prepare("SELECT * FROM runs WHERE tenant_id = 'local' AND session_id = ? ORDER BY started_at DESC LIMIT ?").all(String(sessionId), limit) || []).map(view);
}

/** Plan items not finished, in a mission's plan ([{ title, state }]). */
function openItems(plan) { return (Array.isArray(plan) ? plan : []).filter(i => !['done', 'failed'].includes(i.state)); }

/**
 * After a run ends: if it was a mission's and it ended done with plan items
 * open, say so — on the run, on the mission, and to the conversation that
 * dispatched it. Never throws.
 */
function checkPlan(id) {
  try {
    const run = get(id);
    if (!run || run.state !== 'done' || !run.sessionId) return null;
    const missions = require('../agents/missions');
    const m = missions.forSession(run.sessionId);
    if (!m) return null;
    const open = openItems(m.plan);
    if (!open.length) return null;
    const check = { open: open.map(i => `${i.title} (${i.state || 'queued'})`) };
    raw()?.prepare("UPDATE runs SET plan_check = ? WHERE tenant_id = 'local' AND id = ?").run(JSON.stringify(check), id);
    missions.patch(m.id, { planCheck: check.open });
    // Reported as the mission's own conversation: a report reaches its ancestors, the dispatcher first.
    require('./organization').report(run.sessionId, 'progress',
      `Plan check: ${m.label} (${m.id}) ended done with ${open.length} plan item${open.length === 1 ? '' : 's'} not done — ${check.open.join('; ')}. `
      + 'Read its result before relying on it.', 'panel');
    return check;
  } catch { return null; }
}

module.exports = { begin, end, person, get, forSession, checkPlan, openItems, recoverJobs, recoverTurns, prune };
