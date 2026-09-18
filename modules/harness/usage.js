'use strict';

/**
 * Every model call, one line each, kept.
 *
 * `budget.js` counts a turn while it runs and then forgets it: the step lines
 * reach the live log (a 500-line ring, gone on restart), each assistant row
 * keeps a running total, and the session adds the turn up only when the turn
 * ends cleanly — a stopped or failed turn never did. Summaries and `agent.ask()`
 * calls (the docs reader, the rules review) were not counted anywhere. So "what
 * did this week cost, and on which model" had no answer.
 *
 * One JSONL file per month under `harness/usage/`: append-only, one writer per
 * line, readable with `jq`, and a query for "the last 7 days" opens at most two
 * files. Every row says whether its numbers were measured or estimated, the same
 * honesty the ledger keeps. Tokens, not money: prices change and differ by
 * cache hit, and a stored cost would be wrong the day the price list moves.
 */
const path = require('path');

const store  = require('../store');
const budget = require('./budget');

const fileFor = d => path.join(store.dir('harness/usage'), `${d.toISOString().slice(0, 7)}.jsonl`);

/** Record one call. Never throws: accounting must not break the work it counts. */
function record({ kind, sessionId, agent, provider, model, usage, body, reply }) {
  try {
    const p = Number(usage?.prompt_tokens);
    const c = Number(usage?.completion_tokens);
    const measured = p > 0 && Number.isFinite(c) && c >= 0;
    store.appendJsonl(fileFor(new Date()), {
      at: new Date().toISOString(),
      kind, provider, model,
      ...(sessionId ? { sessionId } : {}),
      ...(agent ? { agent } : {}),
      prompt: p > 0 ? p
        : budget.estimateMessages(body?.messages) + (body?.tools ? budget.estimate(JSON.stringify(body.tools)) : 0),
      completion: Number.isFinite(c) && c >= 0 ? c
        : budget.estimate(reply?.content) + budget.estimate(JSON.stringify(reply?.tool_calls || [])),
      cached: budget.cachedOf(usage),
      source: measured ? 'provider' : 'estimated',
    });
  } catch { /* see above */ }
}

const KEYS = {
  day:      r => r.at.slice(0, 10),
  model:    r => `${r.provider}/${r.model}`,
  provider: r => r.provider,
  session:  r => r.sessionId || '(none)',
  agent:    r => r.agent || 'orchestrator',
  kind:     r => r.kind,
};

/**
 * Totals since `days` ago, grouped. Days are UTC, like every timestamp here.
 * @returns {{ since: string, by: string, total: object, rows: object[] }}
 */
function summary({ days = 7, by = 'day', now = new Date() } = {}) {
  if (!KEYS[by]) throw Object.assign(new Error(`by must be one of: ${Object.keys(KEYS).join(', ')}`), { status: 400 });
  const n = Math.min(Math.max(Number(days) || 7, 1), 366);
  const since = new Date(now.getTime() - n * 86400000);

  const months = new Set();
  for (let d = new Date(since); d <= now; d = new Date(d.getTime() + 86400000)) months.add(d.toISOString().slice(0, 7));
  months.add(now.toISOString().slice(0, 7));

  const zero = () => ({ calls: 0, prompt: 0, completion: 0, cached: 0, estimated: 0 });
  const add = (t, r) => {
    t.calls += 1; t.prompt += r.prompt || 0; t.completion += r.completion || 0;
    t.cached += r.cached || 0; if (r.source !== 'provider') t.estimated += 1;
  };
  const total = zero();
  const groups = new Map();
  const sinceIso = since.toISOString();
  for (const m of months) {
    for (const r of store.readJsonl(path.join(store.dir('harness/usage'), `${m}.jsonl`))) {
      if (!r.at || r.at < sinceIso) continue;
      const k = KEYS[by](r);
      if (!groups.has(k)) groups.set(k, zero());
      add(groups.get(k), r);
      add(total, r);
    }
  }
  const rows = [...groups].map(([key, t]) => ({ key, ...t }));
  rows.sort(by === 'day' ? (a, b) => a.key.localeCompare(b.key)
    : (a, b) => (b.prompt + b.completion) - (a.prompt + a.completion));
  return { since: sinceIso, by, total, rows };
}

module.exports = { record, summary };
