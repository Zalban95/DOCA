'use strict';

/**
 * Work that finishes itself.
 *
 * The owner (the user) talks to the Orchestrator; the Orchestrator hands jobs to
 * work chats and is free again at once; work chats carry their jobs to the end,
 * with specialists under them. Before this, nothing carried anything anywhere: a
 * work chat's turn ended when the model stopped, specialists that finished later
 * woke nobody, and reports sat unread until somebody spoke — so a job with more
 * than one turn in it stalled silently (measured 2026-09-25 with a timer probe).
 *
 * The rule, decided with the owner the same day:
 *   - A work chat's job ends only with a final report (done, failed, blocked, or
 *     a question for the owner) — or when the owner or the Orchestrator stops it.
 *     A turn that ends short of that is followed by another, which this starts.
 *   - While its specialists work, it waits; each one that finishes wakes it.
 *   - The Orchestrator is woken only by final reports, and then tells the owner
 *     — in the chat and on their devices. Progress wakes nobody.
 *   - A restart is not a decision: work it cut off is resumed.
 *
 * This decides mechanically, from states and counts, never by asking a model
 * whether it is done. The brakes are harness params: `autoTurnsPerJob` (0 turns
 * all of this off; past it a job is reported stalled) and `autoWakesPerHour`
 * (every automatic turn, together). An automatic turn always gives way to the
 * owner speaking (turn/lifecycle.claim).
 */
const memory = require('./memory');

const IDLE_TURNS_MAX = 3;   // automatic turns in a row that used no tool: stalled
const RETRY_MS = 10 * 60e3;   // a wake refused by the hourly limit is tried again after this

const CONTINUE = '[panel] Your job is not reported finished, and nothing you started is still running. '
  + 'Carry on with it. If it is over, say so: work_chats report with outcome done, failed, blocked or question.';
const RESULTS = '[panel] Results from your specialists have arrived; they are in your context. Carry on with your job.';
const RESTARTED = '[panel] The panel restarted during your last turn. Carry on where you left off.';

const short = (v, n) => String(v || '').replace(/\s+/g, ' ').slice(0, n);

/* ── Starting a turn ──────────────────────────────────── */

let _turn = (sessionId, message) => require('./agent').turn({
  sessionId, message, auto: true, client: { name: 'Panel', kind: 'agent' },
});
/** Tests replace the model call; nothing else should. */
function _setTurn(fn) { _turn = fn; }
// Tests run scripted model replies in order, and an automatic turn nobody asked
// for would eat them: test/helpers.js switches this off, and a test about the
// supervisor switches it back on. Not a setting — autoTurnsPerJob is the setting.
let _enabled = true;
function _setEnabled(on) { _enabled = !!on; }

const recent = [];   // when each automatic turn started, for the hourly limit

function limits() {
  const p = require('./agent').params();
  const n = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);
  return { perJob: n(p.autoTurnsPerJob, 30), perHour: n(p.autoWakesPerHour, 30) };
}

/**
 * Start an automatic turn. Returns why it did or did not happen: 'woken',
 * 'off' (autonomy switched off), 'busy' (a turn is running — its end decides
 * again), or 'limited' (the hourly limit; tried again later).
 */
function wake(sessionId, message, { retry } = {}) {
  const { perJob, perHour } = limits();
  if (perJob <= 0 || !_enabled) return 'off';
  if (require('./agent').isRunning(sessionId)) return 'busy';
  const hourAgo = Date.now() - 3600e3;
  while (recent.length && recent[0] < hourAgo) recent.shift();
  if (recent.length >= perHour) {
    console.warn(`[supervisor] ${perHour} automatic turns this hour — ${sessionId} waits (autoWakesPerHour).`);
    if (retry) setTimeout(retry, RETRY_MS).unref?.();
    return 'limited';
  }
  recent.push(Date.now());
  Promise.resolve()
    .then(() => _turn(sessionId, message))
    .then(r => afterOrchestrator(sessionId, r))
    .catch(() => { /* the turn records its own failure; afterTurn decides from there */ });
  return 'woken';
}

/** An Orchestrator's automatic reply is for the owner: to their devices too, not only the chat. */
function afterOrchestrator(sessionId, r) {
  const s = memory.getSession(sessionId);
  if (s?.kind !== 'orchestrator' || !r?.text) return;
  try {
    const bus = require('../api-v1/bus'), devices = require('../api-v1/devices');
    const { hasScope } = require('../api-v1/scopes');
    bus.publishWhere(devices.list(), d => hasScope(d.scopes, 'harness:chat'), 'agent.turn', {
      turnId: `auto_${Date.now().toString(36)}`, sessionId, state: 'done', by: 'panel', text: short(r.text, 4000),
    });
  } catch { /* the chat has it either way */ }
}

/* ── Deciding, when a turn ends ───────────────────────── */

function setJob(id, job) { memory.updateSession(id, { job }); }

function specialistsRunning(id) {
  return require('../agents/missions').list({ state: 'running', limit: 200 }).some(m => m.by === id);
}

/** Called by turn/lifecycle.changed when a turn ends. Deferred, so a mission's own bookkeeping lands first. */
function afterTurn(sessionId, info = {}) {
  setImmediate(() => { try { decide(sessionId, info); } catch (e) { console.warn(`[supervisor] ${sessionId}: ${e.message}`); } });
}

function decide(id, info = {}) {
  if (!_enabled) return 'off';
  if (info.preempted) return 'preempted';      // someone took the conversation; their turn decides
  const org = require('./organization');
  let s;
  try { s = org.session(id); } catch { return 'gone'; }
  if (s.kind === 'orchestrator') return deliver(id);
  if (s.kind === 'specialist') return missionEnded(s);
  if (s.kind !== 'work' || s.archivedAt || !s.job) return 'not a job';   // chats from before jobs existed are left alone

  const job = s.job;
  if (info.stopped) {
    if (!org.FINAL.includes(job.state)) setJob(id, { ...job, state: 'stopped' });
    return 'stopped';
  }
  if (org.FINAL.includes(job.state) || job.state === 'stalled') return deliver(s.parentId);
  if (job.state === 'stopped') return 'stopped';

  if (specialistsRunning(id)) { setJob(id, { ...job, state: 'waiting' }); return 'waiting'; }
  // Only results of what this chat dispatched: notices() also lists old missions with no dispatcher.
  if (require('../agents/missions').notices(id).some(m => m.by === id)) {
    setJob(id, { ...job, state: 'working' });
    return wake(id, RESULTS, { retry: () => decide(id) });
  }

  const { perJob } = limits();
  if (perJob <= 0) return 'off';
  const idleTurns = info.steps != null && info.steps <= 1 ? (job.idleTurns || 0) + 1 : 0;
  const autoTurns = (job.autoTurns || 0) + 1;
  if (autoTurns > perJob || idleTurns > IDLE_TURNS_MAX) {
    const why = autoTurns > perJob
      ? `it has taken ${perJob} turns on its own (autoTurnsPerJob) without a final report`
      : `its last ${IDLE_TURNS_MAX} turns did nothing`;
    setJob(id, { ...job, state: 'stalled', autoTurns, idleTurns });
    org.report(id, 'blocked', `Stalled: ${why}. Last brief: ${short(s.brief, 300) || '(none)'}`, 'panel');
    return deliver(s.parentId);
  }
  setJob(id, { ...job, state: 'working', autoTurns, idleTurns });
  return wake(id, CONTINUE, { retry: () => decide(id) });
}

/** A specialist's turn ended: when its mission is over, the work chat that sent it carries on. */
function missionEnded(s) {
  const m = require('../agents/missions').forSession(s.id);
  if (!m || m.state === 'running') return 'mission running';
  const org = require('./organization');
  let lead;
  try { lead = org.session(m.by); } catch { return 'no lead'; }
  if (lead.kind !== 'work' || !lead.job || org.FINAL.includes(lead.job.state)
      || lead.job.state === 'stopped' || lead.job.state === 'stalled') return 'lead not working';
  if (require('./agent').isRunning(lead.id)) return 'lead busy';   // its own turn end picks the result up
  if (specialistsRunning(lead.id)) return 'others still running';  // woken by the last one
  setJob(lead.id, { ...lead.job, state: 'working' });
  return wake(lead.id, RESULTS, { retry: () => missionEnded(s) });
}

/**
 * Wake the Orchestrator for the final reports it has not been woken for yet —
 * only its own work chats' done, failed, blocked and questions. It says what
 * matters to the owner; the reports stay in its context either way.
 */
function deliver(orchestratorId) {
  const org = require('./organization');
  let ceo;
  try { ceo = org.session(orchestratorId); } catch { return 'no orchestrator'; }
  if (ceo.kind !== 'orchestrator') return 'not the orchestrator';
  if (require('./agent').isRunning(ceo.id)) return 'busy';   // its turn's end delivers
  const due = (ceo.reports || []).filter(n => org.FINAL.includes(n.type) && !n.readAt && !n.wokeAt
    && memory.getSession(n.from)?.parentId === ceo.id);
  if (!due.length) return 'nothing due';
  // One line per job: a work chat that reports "done" twice (it happens: a
  // short one, then one with the timings) is one outcome, the latest.
  const latest = [...new Map(due.map(n => [n.from, n])).values()];
  const lines = latest.map(n => `- ${short(memory.getSession(n.from)?.title, 80)} (${n.from}) — ${n.type}: ${short(n.text, 500)}`);
  const how = wake(ceo.id, '[panel] Work reported back. Tell the owner what matters, in a few lines. '
    + 'Where a decision is theirs, ask it with ask_device and give the choices — it reaches their phone, '
    + `their watch and the panel at once.\n${lines.join('\n')}`, { retry: () => deliver(ceo.id) });
  if (how === 'woken') {
    const ids = new Set(due.map(n => n.id)), at = new Date().toISOString();
    memory.updateSessions([ceo.id], row => ({ reports: (row.reports || []).map(n => (ids.has(n.id) ? { ...n, wokeAt: at } : n)) }));
  }
  return how;
}

/**
 * After a restart: carry on what it cut off. Work chats caught mid-turn are
 * resumed; a work chat whose specialist was paused is told so; reports that
 * arrived for the Orchestrator while nothing was running are delivered.
 */
function recover() {
  const org = require('./organization');
  const done = [];
  for (const row of memory.listSessions().sessions) {
    let s;
    try { s = org.session(row.id); } catch { continue; }
    if (s.kind === 'work' && s.job && s.state === 'paused' && ['working', 'waiting'].includes(s.job.state)
        && wake(s.id, RESTARTED) === 'woken') done.push(s.id);
  }
  for (const m of require('../agents/missions').list({ state: 'paused', limit: 200 })) {
    let lead;
    try { lead = org.session(m.by); } catch { continue; }
    if (lead.kind === 'work' && lead.job && !org.FINAL.includes(lead.job.state) && !done.includes(lead.id)
        && wake(lead.id, `[panel] A restart stopped your specialist ${m.label || m.agentId} (${m.id}). `
          + 'Resume it with agent_resume, or do that part another way.') === 'woken') done.push(lead.id);
  }
  deliver(memory.mainSession().id);
  return done;
}

module.exports = { afterTurn, decide, deliver, missionEnded, recover, wake, limits, _setTurn, _setEnabled, CONTINUE, RESULTS, RESTARTED, IDLE_TURNS_MAX };
