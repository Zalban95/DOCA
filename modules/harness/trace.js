'use strict';

/**
 * What each turn did, step by step (TODO H10.1; TODO "Where this harness stands" §4): every model request — which
 * provider and model answered, how long it took, the tokens it was billed, how many messages and tools it carried
 * and a fingerprint of the system prompt it was actually sent — every tool call with its duration and whether it
 * failed or was refused, and the approvals, hops, rate-limit waits and folds in between. A row per span in doca.db
 * (`trace_spans`), tied to the turn's run (runs.js), so "why was that turn slow / expensive / wrong" is read after
 * the fact rather than reconstructed.
 *
 * Made from the events a turn already emits (agent.events) plus one, `step`, emitted after each model reply — so
 * the trace is of what was sent, not of what preview() would assemble. Like the logs, it keeps **names, never
 * values**: tool arguments by parameter name, results by length, no text of the conversation. Kept
 * `tracing.retainDays` (30) days; `tracing.enabled` switches it off. [IO] exports as OTLP/JSON, which Jaeger,
 * Grafana Tempo, Langfuse and any OpenTelemetry collector import.
 */
const crypto = require('crypto');

const raw = () => require('../db').syncHandle();   // null with PostgreSQL: not traced there yet, like runs
const schema = () => require('../settings-schema');
const active = new Map();   // sessionId → { runId, seq, open: Map(tool name → [startedAt…]) }

const fingerprint = text => crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 12);
const argNames = args => (args && typeof args === 'object' ? Object.keys(args) : []);

function write(t, kind, { name = null, step = null, ms = null, data = null } = {}) {
  try {
    raw()?.prepare('INSERT INTO trace_spans (run_id, seq, at, kind, name, step, ms, data) VALUES (?,?,?,?,?,?,?,?)')
      .run(t.runId, ++t.seq, new Date().toISOString(), kind, name, step, ms, data ? JSON.stringify(data) : null);
  } catch { /* a trace must never stop the turn it traces */ }
}

/** One event from a turn, as a span — or nothing, for the kinds that are content (text, thinking). */
function onEvent(evt) {
  const t = active.get(evt.sessionId);
  if (!t) return;
  switch (evt.type) {
    case 'step':
      return write(t, 'model', { name: `${evt.provider} / ${evt.model}`, step: evt.step, ms: evt.ms, data: {
        provider: evt.provider, model: evt.model, finish: evt.finish || null, messages: evt.messages, tools: evt.tools, system: evt.system,
        prompt: evt.usage?.prompt_tokens ?? null, completion: evt.usage?.completion_tokens ?? null, cached: evt.cached ?? null,
        estimate: evt.estimate ?? null, calls: evt.calls || [] } });
    case 'tool_call': {
      const list = t.open.get(evt.name) || [];
      list.push(Date.now());
      t.open.set(evt.name, list);
      return;
    }
    case 'tool_result': {
      const started = (t.open.get(evt.name) || []).shift();
      const risk = t.risks?.get(evt.name)?.shift();   // experiment riskTiers: the tier and its way back (fixed words, a checkpoint id)
      return write(t, 'tool', { name: evt.name, step: evt.step, ms: started ? Date.now() - started : null, data: {
        args: t.args?.get(evt.name)?.shift() || [], chars: String(evt.result ?? '').length, failure: evt.failure?.kind || null,
        ...(risk ? { tier: risk.tier, way: risk.way || null, why: risk.why || null } : {}) } });
    }
    case 'approval':
      return write(t, 'approval', { name: evt.tool || null, step: evt.step, data: { state: evt.state, decision: evt.decision || null } });
    case 'failover':
      return write(t, 'failover', { step: evt.step, data: { from: evt.from || null, to: evt.to || null } });
    case 'warning':
      return write(t, 'warning', { name: evt.kind || null, step: evt.step ?? null,
        data: evt.waitMs ? { waitMs: evt.waitMs } : evt.kind === 'extended' ? { to: evt.to, why: evt.why } : null });
    case 'triage':   // the verdict that set this turn's effort and steps (turn/triage.js)
      return write(t, 'triage', { name: `${evt.difficulty}${evt.urgency === 'quick' ? ' · quick' : ''}`, data: {
        difficulty: evt.difficulty, urgency: evt.urgency, by: evt.by, reasons: evt.reasons, effort: evt.effort, steps: evt.steps, base: evt.base, ceiling: evt.ceiling } });
    case 'effort':   // how hard it thought and why: a mode's setting, a toggle, the person's words, auto (turn/thinking.js)
      return write(t, 'thinking', { name: evt.level || 'default', step: evt.step ?? null, data: { level: evt.level || null, from: evt.from || null, mode: evt.mode || null } });
    case 'compacted':
      return write(t, 'compacted', { step: evt.at ?? null, data: { contextTokens: evt.contextTokens ?? null } });
    case 'error':
      return write(t, 'error', { data: { message: String(evt.text || '').slice(0, 300) } });
    default:
  }
}

// Argument names are known at tool_call; they ride to the result row, so a span says "shell(command)".
function remember(evt) {
  const t = active.get(evt.sessionId);
  if (!t || evt.type !== 'tool_call') return;
  t.args ||= new Map();
  const list = t.args.get(evt.name) || [];
  list.push(argNames(evt.args));
  t.args.set(evt.name, list);
  t.risks ||= new Map();
  t.risks.set(evt.name, [...(t.risks.get(evt.name) || []), evt.risk || null]);
}

let subscribed = false;
function subscribe() {
  if (subscribed) return;
  subscribed = true;
  require('./agent').events.on('event', evt => { remember(evt); onEvent(evt); });
}

/** A turn starts: its spans go under `runId`. */
function start(runId, sessionId) {
  if (!runId || schema().value('tracing.enabled') === false) return;
  subscribe();
  active.set(sessionId, { runId, seq: 0, open: new Map() });
}

function finish(sessionId) { active.delete(sessionId); }

/** A run's spans, in order. */
function spans(runId) {
  try {
    return (raw()?.prepare("SELECT seq, at, kind, name, step, ms, data FROM trace_spans WHERE tenant_id = 'local' AND run_id = ? ORDER BY seq").all(runId) || [])
      .map(r => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));
  } catch { return []; }
}

/** Older than `tracing.retainDays`, and past `tracing.maxSpans` the oldest: gone. Returns how many rows went. */
function prune() {
  const days = schema().value('tracing.retainDays'), max = schema().value('tracing.maxSpans');
  let n = 0;
  try {
    const r = raw();
    if (!r) return 0;
    n += Number(r.prepare("DELETE FROM trace_spans WHERE tenant_id = 'local' AND at < ?").run(new Date(Date.now() - days * 86400000).toISOString()).changes || 0);
    const over = Number(r.prepare("SELECT COUNT(*) AS n FROM trace_spans WHERE tenant_id = 'local'").get().n) - max;
    if (over > 0) n += Number(r.prepare("DELETE FROM trace_spans WHERE rowid IN (SELECT rowid FROM trace_spans WHERE tenant_id = 'local' ORDER BY at, run_id, seq LIMIT ?)").run(over).changes || 0);
  } catch { /* next time */ }
  return n;
}

module.exports = { start, finish, spans, prune, fingerprint, onEvent };
