'use strict';

/**
 * Chronicle: everything that happened, found again (TODO P1.13; CONSTITUTION §1: "nothing runs unseen, but it can be
 * unrendered" — the place unrendered work is seen afterwards).
 *
 * No store of its own. A row is a run (harness/runs.js: one per turn, mission turn and device job), told with what is
 * already known about it: the conversation it ran in and whose it is, the device that asked (kept on the run's
 * detail by agent.js), the agent (the Orchestrator, a work chat, a specialist by its mission), how it ended and what it cost. The
 * harness log's lines since the last start (logs.js) are a source of their own, a host's.
 *
 * Seen per viewer, by the transcript's own rule (session-access.js): a host sees every run; anyone else the runs of
 * conversations they may open and the device jobs of their own devices — the rest are absent, never redacted.
 */
const raw = () => require('../db').syncHandle();
const access = () => require('../harness/session-access');

const SCAN = 3000;   // runs read per query, newest first, before the filters that need more than SQL

/** Caches for one query: a hundred runs of one conversation look it up once. */
function lookups() {
  const memo = (fn) => { const m = new Map(); return k => { if (!m.has(k)) { let v = null; try { v = fn(k); } catch { /* gone */ } m.set(k, v); } return m.get(k); }; };
  const missions = require('../agents/missions');
  return {
    session: memo(id => require('../harness/memory').getSession(id)),
    missionOf: memo(id => missions.forSession(id)),
    mission: memo(id => missions.get(id)),
    person: memo(id => { const u = require('../auth/store').userById(id); return u ? (u.name || u.email || id) : null; }),
    device: memo(id => require('../api-v1/devices').get(id)?.name || null),
  };
}

/** Who did the work: the Orchestrator, a work chat, a specialist (by its definition), a device job. */
function agentOf(run, s, m) {
  if (run.kind === 'job') return { id: 'job', label: 'Device job' };
  if (m) return { id: m.agentId, label: m.label || m.agentId };
  if (s?.kind === 'orchestrator') return { id: 'orchestrator', label: 'Orchestrator' };
  return { id: 'work', label: s?.kind === 'specialist' ? 'Specialist' : 'Work chat' };
}

/** One run as a Chronicle row: names, never content beyond the outcome's first line. */
function row(run, L) {
  const s = run.sessionId ? L.session(run.sessionId) : null;
  const m = run.missionId ? L.mission(run.missionId) : run.sessionId ? L.missionOf(run.sessionId) : null;
  const client = run.detail?.client || null;
  const deviceId = run.kind === 'job' ? run.detail?.deviceId : client?.id;
  return {
    id: run.id, source: run.kind === 'job' ? 'job' : m ? 'mission' : 'turn', state: run.state,
    at: run.startedAt, endedAt: run.endedAt, ms: run.endedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : null,
    steps: run.steps, tokens: run.tokens,
    sessionId: run.sessionId, title: run.kind === 'job' ? `${run.detail?.commandId || 'command'}` : (s?.title || run.sessionId || ''),
    missionId: m?.id || null, agent: agentOf(run, s, m),
    person: run.personId ? { id: run.personId, name: L.person(run.personId) || run.personId } : null,
    device: deviceId ? { id: deviceId, name: L.device(deviceId) || client?.name || deviceId, kind: client?.kind || 'device' }
      : client ? { id: null, name: client.name || client.kind, kind: client.kind } : null,
    outcome: String(run.outcome || '').split('\n').find(l => l.trim())?.slice(0, 240) || '',
    planCheck: run.planCheck,
  };
}

function view(r) {
  return r && { id: r.id, kind: r.kind, sessionId: r.session_id, missionId: r.mission_id, personId: r.person_id, state: r.state, outcome: r.outcome || '',
    steps: r.steps, tokens: r.tokens, planCheck: r.plan_check ? JSON.parse(r.plan_check) : null, startedAt: r.started_at, endedAt: r.ended_at,
    detail: r.detail ? JSON.parse(r.detail) : null };
}

/** May this person see this run: a host every one; anyone else their conversations' and their own devices' jobs. */
function maySee(person, run) {
  if (!person?.id || access().isHost(person)) return true;
  if (run.kind === 'job') return run.personId === person.id;
  return !!run.sessionId && access().mayUse(person, run.sessionId);
}

const has = (hay, q) => hay.some(h => String(h || '').toLowerCase().includes(q));

/**
 * Runs, newest first, filtered: `q` (words in the title, outcome, agent, device or person), `source` (turn, mission,
 * job, or log for the harness log's lines — a host's), `person`, `device`, `agent`, `state`, `from`/`to` (ISO times).
 * With facets — the people, devices, agents and states among the runs this viewer sees in the time range — and totals.
 */
function query(person, f = {}) {
  const limit = Math.min(500, Math.max(1, Number(f.limit) || 200));
  if (f.source === 'log') return logLines(person, f, limit);
  const where = ["tenant_id = 'local'"], args = [];
  if (f.from) { where.push('started_at >= ?'); args.push(String(f.from)); }
  if (f.to) { where.push('started_at <= ?'); args.push(String(f.to)); }
  let runs = [];
  try { runs = (raw()?.prepare(`SELECT * FROM runs WHERE ${where.join(' AND ')} ORDER BY started_at DESC LIMIT ${SCAN}`).all(...args) || []).map(view); } catch { /* no database */ }
  const L = lookups();
  const seen = runs.filter(r => maySee(person, r)).map(r => row(r, L));
  const q = String(f.q || '').trim().toLowerCase();
  const rows = seen.filter(r => (!f.source || r.source === f.source) && (!f.state || r.state === f.state)
    && (!f.person || r.person?.id === f.person) && (!f.device || r.device?.id === f.device || r.device?.name === f.device)
    && (!f.agent || r.agent.id === f.agent) && (!q || has([r.title, r.outcome, r.agent.label, r.device?.name, r.person?.name, r.id], q)));
  const uniq = (list, key) => [...new Map(list.filter(Boolean).map(x => [x[key], x])).values()];
  return {
    rows: rows.slice(0, limit), total: rows.length, scanned: runs.length,
    totals: { tokens: rows.reduce((n, r) => n + (r.tokens || 0), 0), failed: rows.filter(r => r.state === 'failed').length,
      cancelled: rows.filter(r => r.state === 'cancelled').length, running: rows.filter(r => r.state === 'running').length },
    facets: {
      people: uniq(seen.map(r => r.person), 'id'), devices: uniq(seen.map(r => r.device?.id && r.device), 'id'),
      agents: uniq(seen.map(r => r.agent), 'id'), states: [...new Set(seen.map(r => r.state))],
      sources: ['turn', 'mission', 'job', ...(isHost(person) ? ['log'] : [])],
    },
  };
}
function isHost(person) { return !person?.id || access().isHost(person); }

/** The harness log's lines since the last start (logs.js), newest first: a host's, like the Logs tab. */
function logLines(person, f, limit) {
  if (!isHost(person)) return { rows: [], total: 0, totals: {}, facets: { sources: ['turn', 'mission', 'job'] }, note: 'The harness log is an admin\'s.' };
  const q = String(f.q || '').trim().toLowerCase();
  const lines = require('../logs')._ring.filter(l => (!f.from || l.ts >= f.from) && (!f.to || l.ts <= f.to)
    && (!f.state || l.level === f.state) && (!q || String(l.text).toLowerCase().includes(q))).slice().reverse();
  return { rows: lines.slice(0, limit).map(l => ({ source: 'log', at: l.ts, level: l.level, text: l.text, sessionId: l.sessionId || null })),
    total: lines.length, totals: {}, facets: { sources: ['turn', 'mission', 'job', 'log'], states: ['info', 'warn', 'error'] } };
}

module.exports = { query, row, view, lookups, maySee, isHost, SCAN };
