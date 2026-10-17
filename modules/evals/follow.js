'use strict';

/**
 * Following a case's hand-offs (`--follow`; the design "Always free" §6.3). `--orchestrator` counted the work chats a
 * case handed work to but neither waited for them nor counted what they did, so a hand-off failed a tool check or
 * passed it vacuously. With `follow`, a case waits — bounded — for every work chat it started to end its job, and its
 * outcome carries what they did:
 *
 *   childTools, childSteps, childTokens (+ In/Cached/Out)   from their transcripts and runs
 *   allTools     the front's tools and theirs, which the tool checks read when following
 *   resultMs     when the last of them ended (the answer the person was waiting for), else the front turn's end
 *   followed     'done' | 'timed out' (those still working are stopped, so the next case starts clean)
 *   lane         what the front did: talk, look, do-now, job or amend (evals/front.json labels each case with one)
 */
const memory = () => require('../harness/memory');
const ENDED = ['done', 'failed', 'blocked', 'question', 'stalled', 'stopped', 'dropped'];
const FOLLOW_MS = 10 * 60e3;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const childrenOf = (id, since) => memory().listSessions().sessions.filter(x => x.parentId === id && x.kind === 'work' && (!since || x.createdAt >= since));
const ended = id => { const s = memory().getSession(id); return !require('../harness/agent').isRunning(id) && (!s?.job || ENDED.includes(s.job.state)); };

/** What the work chats did: tools in order, steps and tokens summed over their runs. */
function stats(ids) {
  const out = { childTools: [], childSteps: 0, childTokens: 0, childTokensIn: 0, childTokensCached: 0, childTokensOut: 0, childText: '' };
  for (const id of ids) {
    // Its last report, which is what the person gets (audit 2026-10-17: the judge read only the front's hand-over and
    // failed three runs that had delivered every file).
    const said = memory().messages(id).filter(r => r.role === 'assistant' && String(r.content || '').trim()).at(-1)?.content;
    if (said) out.childText = `${out.childText}${out.childText ? '\n\n' : ''}${String(said).slice(0, 4000)}`;
    for (const r of memory().messages(id)) if (r.role === 'assistant' && Array.isArray(r.tool_calls)) out.childTools.push(...r.tool_calls.map(c => c.function?.name).filter(Boolean));
    for (const run of require('../harness/runs').forSession(id, 200)) {
      out.childSteps += run.steps || 0;
      out.childTokens += run.tokens || 0;
      const model = require('../harness/trace').spans(run.id).filter(s => s.kind === 'model').map(s => s.data || {});
      for (const m of model) { out.childTokensIn += m.prompt || 0; out.childTokensCached += m.cached || 0; out.childTokensOut += m.completion || 0; }
    }
  }
  return out;
}

/**
 * Wait for the case's work chats (made since `since`) to end, at most `ms`; then for the main chat's own relay turn.
 * @returns {Promise<object>} the fields above
 */
async function follow(sessionId, { since, began, ms = FOLLOW_MS } = {}) {
  const deadline = Date.now() + ms;
  let last = null, ids = [];
  for (;;) {
    ids = childrenOf(sessionId, since).map(x => x.id);   // a worker's split adds one: read again each round
    if (ids.every(ended)) break;
    if (Date.now() > deadline) break;
    await sleep(250);
  }
  const timedOut = !ids.every(ended);
  for (const id of ids) if (!ended(id)) require('../harness/agent').cancel(id);
  for (const id of ids) {
    const at = memory().getSession(id)?.job?.at || memory().getSession(id)?.updatedAt;
    if (at && (!last || at > last)) last = at;
  }
  // The main chat's relay of their reports (supervisor.deliver), so the next case does not start under it.
  while (require('../harness/agent').isRunning(sessionId) && Date.now() < deadline + 30e3) await sleep(250);
  return { ...stats(ids), children: ids.length, resultMs: ids.length && last ? Math.max(0, Date.parse(last) - began) : null,
    followed: timedOut ? 'timed out' : 'done' };
}

/** What the front did in its own turn, from its rows: the lane a case is labelled with. */
function laneOf(rows, { children = 0 } = {}) {
  const calls = rows.filter(r => r.role === 'assistant' && Array.isArray(r.tool_calls)).flatMap(r => r.tool_calls);
  const args = c => { try { return JSON.parse(c.function?.arguments || '{}'); } catch { return {}; } };
  if (calls.some(c => c.function?.name === 'background' && ['add', 'cancel', 'stop'].includes(args(c).action))) return 'amend';
  if (children > 0) return 'job';
  const handoff = require('../harness/turn/handoff');
  if (calls.some(c => handoff.isWork(c) || handoff.isQuick(c) || ['remind', 'schedule', 'settings_propose', 'panel_layout', 'tell_device', 'screen', 'memory_write', 'memory_forget'].includes(c.function?.name))) return 'do-now';
  return calls.length ? 'look' : 'talk';
}

module.exports = { follow, laneOf, stats, childrenOf, FOLLOW_MS, ENDED };
