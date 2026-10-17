'use strict';

/**
 * Many steps and nothing moving (2026-10-17): a work chat spent 1 h 40 min and ~240 commands on the last step of its
 * plan, writing and re-patching a robot player of its own while the game did not change — every call succeeded, so the
 * failure-loop brake (failures.js) never fired, and the supervisor kept giving it turns. Read from the conversation's
 * own rows, mechanically, no model asked: steps since anything moved, where moving is
 *   - a plan step changing state (work_plan progress done/failed/blocked/cancelled; add, change, cancel, split, a new
 *     draft or proposal; a mission_plan with more items done or failed than its last),
 *   - work handed on (a team made, a specialist dispatched, a work chat made, sent to, or a report filed),
 *   - a file written into the conversation's own project (write_file, replace_in_files under its root), a commit or a
 *     merge there (a shell `git commit|merge` that answered exit 0),
 *   - a new message from a person or a leader (DOCA's own notes and the panel's automatic wakes do not count).
 * Only a conversation with an open plan is counted: without one there is nothing to judge it by. At `stallSteps`
 * (harness.config.doca, 40; 0 = off) the next step reads a note from DOCA: take stock and report. Ten steps later (a
 * quarter of it, at least 5) a step is kept for the report — no tools, the way a mission's last step is — and the turn
 * ends; the supervisor then treats it as it treats a failure loop (one try on a stronger model, else blocked and
 * reported to the leader). Counted across turns, so a new turn woken only by the panel carries on counting.
 */
const path = require('path');

const PLAN_MOVES = new Set(['add', 'change', 'cancel', 'split', 'draft', 'propose']);
const HANDED = { team: a => ['create', 'keep_going'].includes(a.action), agent_dispatch: () => true,
  work_chats: a => ['create', 'send', 'report', 'restart'].includes(a.action) };
const WRITES = new Set(['write_file', 'replace_in_files']);
const GIT = /\bgit\b[^;&|\n]*\b(commit|merge|cherry-pick)\b/;
const _stalled = new WeakMap();   // a turn's signal → { steps }: read by lifecycle.js for the supervisor

const args = c => { try { return JSON.parse(c.function?.arguments || '{}') || {}; } catch { return {}; } };
const ok = res => res != null && !/^(Error|Not run|Refused|Denied)\b/.test(String(res).trim());
const isDoca = r => r.from?.formFactor === 'hub' || r.from?.name === 'DOCA' || r.from?.name === 'Panel';

/** The limit and the report step for these params, or null when it is off. */
function limits(p) {
  const n = Number(p?.stallSteps ?? 40);
  if (!(n > 0)) return null;
  return { note: n, report: n + Math.max(5, Math.round(n / 4)) };
}

/** Whether one call moved the work. `root` the project's folders; `prevDone` a mission_plan's last done count. */
function moved(name, a, result, root, state) {
  if (!ok(result)) return false;
  if (name === 'work_plan') return PLAN_MOVES.has(a.action) || (a.action === 'progress' && ['done', 'failed', 'blocked', 'cancelled'].includes(a.state));
  if (name === 'mission_plan') {
    const done = (Array.isArray(a.items) ? a.items : []).filter(i => ['done', 'failed'].includes(i?.state)).length;
    const more = state.missionDone == null || done > state.missionDone;
    return more && done > 0;
  }
  if (HANDED[name]) return HANDED[name](a);
  if (WRITES.has(name)) {
    const files = [a.path, ...(Array.isArray(a.paths) ? a.paths : [])].filter(Boolean).map(String);
    return root.length > 0 && files.some(f => root.some(r => { const R = path.resolve(r), abs = path.resolve(R, f); return abs === R || abs.startsWith(R + path.sep); }));
  }
  if (name === 'shell') return GIT.test(String(a.command || '')) && /^exit 0\b/.test(String(result).trim());
  return false;
}

/**
 * Steps since the work last moved, counted back from the end: { steps, noted } — `noted` when DOCA's note for this
 * stretch is already among them. `root`: the folders of the conversation's project (main and worktree).
 */
function since(rows, root = []) {
  const results = new Map();
  for (const r of rows) if (r.role === 'tool' && r.tool_call_id) results.set(r.tool_call_id, r.content);
  // mission_plan's done count is compared with the call before it, so the oldest one is read first.
  const state = { missionDone: null };
  const moves = new Array(rows.length).fill(false);
  rows.forEach((r, i) => {
    if (r.role === 'user' && !isDoca(r)) { moves[i] = true; return; }
    for (const c of r.tool_calls || []) {
      const name = c.function?.name, a = args(c);
      if (moved(name, a, results.get(c.id), root, state)) moves[i] = true;
      if (name === 'mission_plan') state.missionDone = (Array.isArray(a.items) ? a.items : []).filter(x => ['done', 'failed'].includes(x?.state)).length;
    }
  });
  let steps = 0, noted = false;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (moves[i]) break;
    const r = rows[i];
    if (r.role === 'assistant' && (r.tool_calls || []).length) steps++;
    if (r.role === 'user' && r.stall) noted = true;
  }
  return { steps, noted };
}

/** The project folders this conversation works in, for counting writes there. */
function rootsOf(session) {
  try { const pr = require('../../projects/store').forSession(session.id); return [pr?.root, pr?.mainRoot].filter(Boolean).map(r => path.resolve(r)); } catch { return []; }
}

/** Whether this conversation is counted: an open plan of its own (or its mission's), and not the Orchestrator. */
function counted(session) {
  if (!session || session.kind === 'orchestrator') return false;
  try { const pg = require('../plan-progress').forSession(session); return !!pg && pg.done < pg.total && !pg.fulfilled; } catch { return false; }
}

const DOCA = { id: null, name: 'DOCA', formFactor: 'hub' };
const how = session => (session.kind === 'work' ? 'work_chats report (outcome blocked, or question)' : 'your answer (it is what your leader or the person reads)');

/**
 * For agent.js, once per step before the request: null, or { row, report } — a note to append (report false), or the
 * report step (report true: no tools offered; the turn ends on the answer, and the supervisor hears it).
 */
function at({ session, rows, p, signal }) {
  const lim = limits(p);
  if (!lim || !counted(session)) return null;
  const { steps, noted } = since(rows, rootsOf(session));
  if (steps >= lim.report) {
    if (signal) _stalled.set(signal, { steps });
    return { report: true, row: { role: 'user', from: DOCA, stall: true,
      content: `[DOCA] No tools now: ${steps} steps without the work moving (harness.config.doca.stallSteps is ${lim.note}). `
        + 'Write your report as your answer — it is what your leader or the person gets: what you did, where the work stands, '
        + 'what blocks you, what you tried, and what you would need to finish. Say plainly that it is not done.' } };
  }
  if (steps >= lim.note && !noted) {
    return { report: false, row: { role: 'user', from: DOCA, stall: true,
      content: `[DOCA] ${steps} steps since anything moved: no plan step changed, nothing was handed on, nothing was written `
        + 'into the project. That is how going in circles looks — building tooling around the task instead of doing it. '
        + 'Take stock now: if one more step truly finishes the open plan step, do it and mark it; otherwise stop and report '
        + `where you are with ${how(session)} — what you tried, what blocks you, what you need. `
        + `In ${lim.report - steps} more steps without progress, tools stop and you write that report.` } };
  }
  return null;
}

/** The line after the report, so whoever reads it knows the turn stopped for lack of progress, not because it finished. */
function ending(steps) {
  return `This turn stopped after ${steps} steps without the work moving (harness.config.doca.stallSteps): the report `
    + 'above is where it stands, not a finished job.';
}

/** lifecycle.js: { steps } when this turn ended on the report step, else null. */
const of = signal => (signal && _stalled.get(signal)) || null;

module.exports = { at, since, moved, limits, counted, ending, of };
