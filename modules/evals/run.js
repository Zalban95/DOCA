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

/** What a turn did, from its conversation: the answer and the tools it called, in order. */
function outcomeOf(sessionId, r, error) {
  const memory = require('../harness/memory');
  const rows = memory.messages(sessionId);
  const tools = rows.filter(x => x.role === 'assistant' && Array.isArray(x.tool_calls)).flatMap(x => x.tool_calls.map(c => c.function?.name)).filter(Boolean);
  const run = r?.runId ? require('../harness/runs').get(r.runId) : null;
  return { text: r?.text || '', tools, steps: r?.steps ?? run?.steps ?? null, tokens: r?.usage?.totalTokens ?? run?.tokens ?? null,
    ms: run?.endedAt ? new Date(run.endedAt) - new Date(run.startedAt) : null, state: error ? 'failed' : r?.ended || 'done', error: error?.message || null };
}

async function runCase(kase, setId) {
  const memory = require('../harness/memory');
  const s = memory.createSession(`Eval · ${setId} · ${kase.id}`, { activate: false });
  if (kase.mode && kase.mode !== 'agent') memory.updateSession(s.id, { mode: kase.mode });
  let r = null, error = null;
  try { r = await require('../harness/agent').turn({ message: kase.prompt, sessionId: s.id, client: CLIENT }); }
  catch (e) { error = e; }
  const o = outcomeOf(s.id, r, error);
  const checks = await require('./check').evaluate(kase, o);
  return { id: kase.id, prompt: kase.prompt, ...(kase.difficulty ? { difficulty: kase.difficulty } : {}), ...o, text: String(o.text).slice(0, 4000), checks, pass: checks.every(c => c.pass) };
}

/** Every case in order; `onCase(result, i, n)` after each. Returns the whole result, with regressions against `previous`. */
async function runSet(set, { onCase = () => {}, previous = null } = {}) {
  const p = require('../harness/agent').params();
  const startedAt = new Date().toISOString();
  const cases = [];
  for (let i = 0; i < set.cases.length; i++) {
    const c = await runCase(set.cases[i], set.id);
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
