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
 * A table in the database since 2.107.0 (docs/design/database.md; the monthly
 * JSONL files it replaced are imported once and left in place). Every row says whether its numbers were measured or estimated, the same
 * honesty the ledger keeps. Tokens, not money: prices change and differ by
 * cache hit, and a stored cost would be wrong the day the price list moves.
 */
const fs   = require('fs');
const path = require('path');

const store  = require('../store');
const budget = require('./budget');
const db     = require('../db');

// The ledger was one JSONL file a month under harness/usage/ until 2.107.0; it
// now lives in the database (docs/design/database.md). Those files are read
// once, into the table, and left where they are.
const fileFor = d => path.join(store.dir('harness/usage'), `${d.toISOString().slice(0, 7)}.jsonl`);

let _imported = null;
function imported() {
  if (!_imported) _imported = (async () => {
    if (await db.get("SELECT value FROM meta WHERE key = 'usage.imported'")) return;
    const dir = store.dir('harness/usage');
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort(); } catch { /* none */ }
    await db.tx(async q => {
      // Checked again under the write lock: another process (npm run status, the panel) may have imported meanwhile.
      if (await q.get("SELECT value FROM meta WHERE key = 'usage.imported'")) return;
      for (const f of files) for (const r of store.readJsonl(path.join(dir, f))) {
        if (!r.at) continue;
        await q.run('INSERT INTO usage (at, kind, provider, model, session_id, agent, prompt, completion, cached, source) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [r.at, r.kind || null, r.provider || null, r.model || null, r.sessionId || null, r.agent || null, r.prompt || 0, r.completion || 0, r.cached || 0, r.source || null]);
      }
      await q.run("INSERT INTO meta (key, value) VALUES ('usage.imported', ?)", [new Date().toISOString()]);
    });
  })().catch(e => { _imported = null; throw e; });
  return _imported;
}

/**
 * Who a call was for, kept on its row when it is written: the conversation's owner (the rule spending always read,
 * session-access.ownerOf), else the person on the call. Read back first by spending (spending/spent.js), so a
 * conversation deleted later still counts for its person.
 */
function personOf(person, sessionId) {
  let owner = null;
  if (sessionId) try { owner = require('./session-access').ownerOf(sessionId); } catch { /* removed meanwhile */ }
  return owner || (person?.id ? String(person.id) : null);
}

/** Record one call. Never throws: accounting must not break the work it counts. */
function record({ kind, sessionId, agent, provider, model, usage, body, reply, person }) {
  try {
    const p = Number(usage?.prompt_tokens);
    const c = Number(usage?.completion_tokens);
    const measured = p > 0 && Number.isFinite(c) && c >= 0;
    const row = [new Date().toISOString(), kind || null, provider || null, model || null, sessionId || null, agent || null,
      p > 0 ? p : budget.estimateMessages(body?.messages) + (body?.tools ? budget.estimate(JSON.stringify(body.tools)) : 0),
      Number.isFinite(c) && c >= 0 ? c : budget.estimate(reply?.content) + budget.estimate(JSON.stringify(reply?.tool_calls || [])),
      budget.cachedOf(usage) || 0, measured ? 'provider' : 'estimated', personOf(person, sessionId)];
    imported().then(() => db.run('INSERT INTO usage (at, kind, provider, model, session_id, agent, prompt, completion, cached, source, person_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)', row))
      .catch(e => console.warn(`[usage] not recorded: ${e.message}`));
  } catch { /* see above */ }
}

const KEYS = {
  day:      "substr(at, 1, 10)",
  model:    "coalesce(provider, '') || '/' || coalesce(model, '')",
  provider: "coalesce(provider, '')",
  session:  "coalesce(session_id, '(none)')",
  agent:    "coalesce(agent, 'orchestrator')",
  kind:     "coalesce(kind, '')",
};

/**
 * Totals since `days` ago, grouped. Days are UTC, like every timestamp here.
 * @returns {Promise<{ since: string, by: string, total: object, rows: object[] }>}
 */
async function summary({ days = 7, by = 'day', now = new Date() } = {}) {
  if (!KEYS[by]) throw Object.assign(new Error(`by must be one of: ${Object.keys(KEYS).join(', ')}`), { status: 400 });
  await imported();
  const n = Math.min(Math.max(Number(days) || 7, 1), 366);
  const since = new Date(now.getTime() - n * 86400000).toISOString();
  const cols = `count(*) AS calls, coalesce(sum(prompt), 0) AS prompt, coalesce(sum(completion), 0) AS completion,
    coalesce(sum(cached), 0) AS cached, coalesce(sum(CASE WHEN source = 'provider' THEN 0 ELSE 1 END), 0) AS estimated`;
  const num = r => ({ calls: Number(r.calls), prompt: Number(r.prompt), completion: Number(r.completion), cached: Number(r.cached), estimated: Number(r.estimated) });
  const total = num(await db.get(`SELECT ${cols} FROM usage WHERE tenant_id = 'local' AND at >= ?`, [since]));
  const rows = (await db.all(`SELECT ${KEYS[by]} AS key, ${cols} FROM usage WHERE tenant_id = 'local' AND at >= ? GROUP BY ${KEYS[by]}`, [since]))
    .map(r => ({ key: r.key, ...num(r) }));
  rows.sort(by === 'day' ? (a, b) => a.key.localeCompare(b.key)
    : (a, b) => (b.prompt + b.completion) - (a.prompt + a.completion));
  return { since, by, total, rows };
}

/**
 * Totals between two instants per conversation, model and UTC day — what spending (spending/spent.js) attributes to
 * the person whose conversation it is. `until` is exclusive.
 */
async function byConversation({ since, until }) {
  await imported();
  return (await db.all(`SELECT session_id AS session, person_id AS person, coalesce(provider, '') || '/' || coalesce(model, '') AS key, substr(at, 1, 10) AS day,
      count(*) AS calls, coalesce(sum(prompt), 0) AS prompt, coalesce(sum(completion), 0) AS completion, coalesce(sum(cached), 0) AS cached
    FROM usage WHERE tenant_id = 'local' AND at >= ? AND at < ? GROUP BY session_id, person_id, provider, model, substr(at, 1, 10)`, [since, until]))
    .map(r => ({ session: r.session || null, person: r.person || null, key: r.key, day: r.day, calls: Number(r.calls), prompt: Number(r.prompt), completion: Number(r.completion), cached: Number(r.cached) }));
}

module.exports = { record, summary, byConversation, fileFor };
