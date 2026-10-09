'use strict';

/**
 * Run an evaluation set (TODO H10.1): each case is a real turn — the configured model, the harness's prompt, tools,
 * approvals and limits — in a conversation of its own (in the case's mode: Ask and Plan refuse work by code), and
 * what it did is read back from its run and transcript and held to the case's checks (check.js). The result says,
 * per case, the answer, the tools in order, steps, tokens and time, and which checks passed; compared with the
 * set's previous result it names what regressed and what was fixed.
 *
 * Spends the configured model's tokens. bin/doca-eval.js runs it on a throwaway copy of the settings, so the cases'
 * conversations and anything their tools wrote never land in the real data.
 */
const CLIENT = { name: 'Evaluation', kind: 'browser', formFactor: 'desktop', screen: { w: 1440, h: 900 } };
/** A case may ask from another kind of device (`client: "phone"` or `"watch"`), as a person with only that would. */
const CLIENTS = {
  phone: { name: 'Evaluation phone', kind: 'phone', formFactor: 'phone', screen: { w: 412, h: 915 }, input: { touch: true, voice: true, text: true, camera: true } },
  watch: { name: 'Evaluation watch', kind: 'watch', formFactor: 'watch', screen: { w: 450, h: 450, shape: 'round' }, input: { touch: true, voice: true } },
};

/**
 * The turn's model requests in numbers, from its trace (harness/trace.js): tokens sent, read from the provider's cache
 * and written back, and the most a step sent — what a leaner prompt is measured by. Null where nothing was traced.
 */
function spent(runId) {
  const model = runId ? require('../harness/trace').spans(runId).filter(s => s.kind === 'model').map(s => s.data || {}) : [];
  if (!model.length) return {};
  const sum = k => model.some(m => m[k] != null) ? model.reduce((n, m) => n + (m[k] || 0), 0) : null;
  return { tokensIn: sum('prompt'), tokensCached: sum('cached'), tokensOut: sum('completion'),
    stepMax: Math.max(...model.map(m => m.prompt ?? m.estimate ?? 0)), toolsSent: Math.max(...model.map(m => m.tools || 0)) };
}

/** What a turn did, from its conversation: the answer and the tools it called, in order. */
function outcomeOf(sessionId, r, error, seen = {}) {
  const memory = require('../harness/memory');
  const rows = memory.messages(sessionId);
  const tools = rows.filter(x => x.role === 'assistant' && Array.isArray(x.tool_calls)).flatMap(x => x.tool_calls.map(c => c.function?.name)).filter(Boolean);
  const run = r?.runId ? require('../harness/runs').get(r.runId) : null;
  // Work chats it handed work to — made during this case: a fresh Orchestrator inherits the last one's (memory.resetMain).
  const children = memory.listSessions().sessions.filter(x => x.parentId === sessionId && (!seen.since || x.createdAt >= seen.since)).length;
  return { text: r?.text || '', tools, steps: r?.steps ?? run?.steps ?? null, tokens: r?.usage?.totalTokens ?? run?.tokens ?? null,
    ...spent(r?.runId || run?.id), firstMs: seen.firstMs ?? null, children,
    ms: run?.endedAt ? new Date(run.endedAt) - new Date(run.startedAt) : null, state: error ? 'failed' : r?.ended || 'done', error: error?.message || null };
}

/**
 * `as: 'orchestrator'` (the CLI's --orchestrator, or a case's own `as`) asks the Orchestrator, as a person in the main
 * chat does — a fresh one per case (the last put away, as Clear main chat does), so its hand-off to work chats is what
 * is measured; otherwise the case is a conversation of its own (a work chat), as before.
 */
async function runCase(kase, setId, { as = null } = {}) {
  const memory = require('../harness/memory');
  const s = (kase.as || as) === 'orchestrator' ? memory.resetMain()
    : memory.createSession(`Eval · ${setId} · ${kase.id}`, { activate: false });
  if (kase.mode && kase.mode !== 'agent') memory.updateSession(s.id, { mode: kase.mode });
  let r = null, error = null;
  // When the first word, thought or tool call came: what a person waits before anything happens.
  const agent = require('../harness/agent'), began = Date.now(), seen = { since: new Date(began).toISOString() };
  const first = evt => { if (evt.sessionId === s.id && seen.firstMs == null && ['text', 'thinking', 'tool_call'].includes(evt.type)) seen.firstMs = Date.now() - began; };
  agent.events.on('event', first);
  try { r = await agent.turn({ message: kase.prompt, sessionId: s.id, client: CLIENTS[kase.client] || CLIENT }); }
  catch (e) { error = e; }
  finally { agent.events.off('event', first); }
  const o = outcomeOf(s.id, r, error, seen);
  const checks = await require('./check').evaluate(kase, o);
  return { id: kase.id, prompt: kase.prompt, ...(kase.difficulty ? { difficulty: kase.difficulty } : {}), ...o, text: String(o.text).slice(0, 4000), checks, pass: checks.every(c => c.pass) };
}

/** Every case in order; `onCase(result, i, n)` after each. Returns the whole result, with regressions against `previous`. */
async function runSet(set, { onCase = () => {}, previous = null, as = null } = {}) {
  const p = require('../harness/agent').params();
  const startedAt = new Date().toISOString();
  const cases = [];
  for (let i = 0; i < set.cases.length; i++) {
    const c = await runCase(set.cases[i], set.id, { as });
    cases.push(c);
    onCase(c, i + 1, set.cases.length);
  }
  const was = new Map((previous?.cases || []).map(c => [c.id, c.pass]));
  return { set: set.id, title: set.title, model: `${p.provider} / ${p.model}`, startedAt, endedAt: new Date().toISOString(),
    passed: cases.filter(c => c.pass).length, total: cases.length, tokens: cases.reduce((n, c) => n + (c.tokens || 0), 0),
    regressed: cases.filter(c => !c.pass && was.get(c.id) === true).map(c => c.id),
    fixed: cases.filter(c => c.pass && was.get(c.id) === false).map(c => c.id), cases };
}

module.exports = { runSet, runCase, outcomeOf };
