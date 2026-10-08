'use strict';

/**
 * The story of one piece of work (TODO P1.13): a conversation, a mission or one run, told from its runs and their
 * traces — what ran (each turn, model and tool, in order), why (who or what asked: a person's device, a mission's
 * task, the supervisor carrying a job on), what it cost (tokens, cached, the owner's prices where set) and what
 * failed (failed tools, refusals, errors, failovers, waits). With the conversations it started below it — its
 * missions and work chats — so a request that fanned out reads as one story.
 *
 * Built from runs.js, trace.js and missions.js; nothing is stored for it. Names and numbers, never the conversation's
 * words beyond each run's first line of outcome — the transcript stays behind its own page.
 */
const chron = require('./index');
const raw = () => require('../db').syncHandle();

/** What one run's spans add up to. */
function summarize(spans, prices) {
  const s = { models: {}, tools: {}, toolCalls: 0, failed: [], approvals: 0, refused: 0, failovers: 0, warnings: [], errors: [],
    prompt: 0, completion: 0, cached: 0, cost: null, modelMs: 0, toolMs: 0, thinking: [] };
  for (const sp of spans) {
    const d = sp.data || {};
    if (sp.kind === 'model') {
      const key = `${d.provider}/${d.model}`;
      s.models[key] = (s.models[key] || 0) + 1;
      s.prompt += d.prompt || 0; s.completion += d.completion || 0; s.cached += d.cached || 0; s.modelMs += sp.ms || 0;
      const c = require('../harness/prices').cost({ key, prompt: d.prompt || 0, completion: d.completion || 0, cached: d.cached || 0 }, prices);
      if (c != null) s.cost = (s.cost || 0) + c;
    } else if (sp.kind === 'tool') {
      s.toolCalls++; s.toolMs += sp.ms || 0;
      s.tools[sp.name] = (s.tools[sp.name] || 0) + 1;
      if (d.failure) s.failed.push({ name: sp.name, step: sp.step, why: d.failure });
    } else if (sp.kind === 'approval') {
      if (d.state === 'asked') s.approvals++;
      if (d.state === 'refused' || (d.state === 'answered' && !['once', 'always', 'always_tool'].includes(d.decision))) s.refused++;
    } else if (sp.kind === 'failover') s.failovers++;
    else if (sp.kind === 'warning') s.warnings.push(sp.name || 'warning');
    else if (sp.kind === 'error') s.errors.push(d.message || 'error');
    else if (sp.kind === 'thinking') s.thinking.push({ level: d.level, from: d.from, mode: d.mode, step: sp.step });   // turn/thinking.js
  }
  return s;
}

/** Why a run happened, in a phrase. */
function why(row, run, mission) {
  const c = run.detail?.client;
  if (run.kind === 'job') return `${row.device?.name || 'A device'} asked for the command ${run.detail?.commandId || ''}`.trim();
  if (mission && !c) return `Mission for ${mission.label || mission.agentId}: ${String(mission.task || '').split('\n')[0].slice(0, 200)}`;
  if (c?.kind === 'agent') return 'Carried on by the hub (the supervisor or an automatic reply), not a new request';
  if (c?.kind === 'schedule') return `${c.name} (a schedule)`;
  if (c?.kind === 'recipe') return 'A recipe run';
  if (c) return `${row.person?.name || 'Someone'} asked from ${c.name || c.kind}`;
  return mission ? `Mission: ${mission.label || mission.agentId}` : 'No record of who asked (a run older than that record)';
}

function runsOf(sessionId) {
  try { return (raw()?.prepare("SELECT * FROM runs WHERE tenant_id = 'local' AND session_id = ? ORDER BY started_at").all(sessionId) || []).map(chron.view); }
  catch { return []; }
}

/** Conversations started below this one: its missions and work chats (one level; each opens as its own story). */
function children(sessionId, person, L) {
  const memory = require('../harness/memory');
  return memory.listSessions().sessions.filter(s => s.parentId === sessionId && require('../harness/session-access').mayUse(person, s.id))
    .map(s => { const m = L.missionOf(s.id); return { sessionId: s.id, title: s.title, kind: m ? 'mission' : s.kind || 'work', missionId: m?.id || null,
      agent: m ? (m.label || m.agentId) : 'Work chat', state: m?.state || s.state || null, updatedAt: s.updatedAt }; });
}

const no = () => Object.assign(new Error('Nothing like that in the chronicle.'), { status: 404 });

/** `{run}`, `{mission}` or `{session}` → the story. A 404 for what this person may not open, as if absent. */
function story(person, { run: runId, mission: missionId, session: sessionId } = {}) {
  const L = chron.lookups();
  let mission = null, only = null;
  if (runId) {
    only = chron.view(raw()?.prepare("SELECT * FROM runs WHERE tenant_id = 'local' AND id = ?").get(String(runId)));
    if (!only || !chron.maySee(person, only)) throw no();
    sessionId = only.sessionId;
  } else if (missionId) {
    mission = L.mission(String(missionId));
    if (!mission) throw no();
    sessionId = mission.sessionId;
  }
  if (!sessionId && !only) throw no();
  if (sessionId && !require('../harness/session-access').mayUse(person, sessionId)) throw no();
  const s = sessionId ? L.session(sessionId) : null;
  mission ||= sessionId ? L.missionOf(sessionId) : null;
  const prices = require('../harness/prices').load();
  const trace = require('../harness/trace');
  const runs = (only ? [only] : runsOf(sessionId)).map(run => {
    const row = chron.row(run, L), spans = trace.spans(run.id);
    return { ...row, why: why(row, run, mission), summary: summarize(spans, prices), spans: only ? spans : undefined };
  });
  if (sessionId && !runs.length && !s) throw no();
  const sum = (k) => runs.reduce((n, r) => n + (r.summary[k] || 0), 0);
  const costs = runs.map(r => r.summary.cost).filter(c => c != null);
  return {
    title: only && only.kind === 'job' ? runs[0].title : s?.title || mission?.label || sessionId,
    sessionId, kind: mission ? 'mission' : s?.kind || (only?.kind === 'job' ? 'job' : 'work'),
    mission: mission && { id: mission.id, agent: mission.label || mission.agentId, task: String(mission.task || '').slice(0, 600), state: mission.state,
      plan: mission.plan || null, planCheck: mission.planCheck || null, error: mission.error || null, by: mission.by || null },
    parentId: s?.parentId || null,
    totals: { runs: runs.length, steps: runs.reduce((n, r) => n + (r.steps || 0), 0), tokens: runs.reduce((n, r) => n + (r.tokens || 0), 0),
      prompt: sum('prompt'), completion: sum('completion'), cached: sum('cached'), toolCalls: sum('toolCalls'),
      failedTools: runs.reduce((n, r) => n + r.summary.failed.length, 0), failedRuns: runs.filter(r => r.state === 'failed').length,
      ms: runs.reduce((n, r) => n + (r.ms || 0), 0), cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null, currency: prices.currency },
    runs, children: sessionId ? children(sessionId, person, L) : [],
    log: chron.isHost(person) && sessionId ? require('../logs')._ring.filter(l => l.sessionId === sessionId).slice(-200) : [],
  };
}

module.exports = { story, summarize, why };
