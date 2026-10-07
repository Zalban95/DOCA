'use strict';

/**
 * The agent does as much as possible at the lowest risk (experiment riskTiers, docs/experiments/risk-tiers.md; TODO
 * H10.11). What a turn does with a call's tier (classify.js):
 *
 *   before(name, args, {sessionId})  the call's risk, said on its tool_call event (so the trace and the Workstream name
 *                                    it); a reversible call that changes files in a project gets a checkpoint first,
 *                                    and the checkpoint is its way back
 *   ask(name, args, ctx, summarize)  for approval.gate: an outward call is a person's question in every mode, never
 *                                    "always" (keys null), refused in a mission
 *   block()                          one line in the prompt, so the agent plans for the question
 *
 * Off — the flag or developer mode — every function returns null or '' and nothing about a call changes.
 */
const fs = require('fs');
const { classify } = require('./classify');

const on = () => require('../../experiments').on('riskTiers');

function projectOf(sessionId) {
  try {
    const p = sessionId ? require('../../projects/store').forSession(sessionId) : null;
    return p?.root && fs.existsSync(p.root) ? p : null;
  } catch { return null; }
}

function annotations(name) {
  try {
    const t = require('../../mcp/tools').available().find(x => x.exposed === name);
    return t ? { readOnly: !!t.readOnly, destructive: !!t.destructive, openWorld: !!t.openWorld } : null;
  } catch { return null; }
}

/** The call's tier where it runs, without side effects. */
function of(name, args, { sessionId } = {}) {
  return classify(name, args, { root: projectOf(sessionId)?.root || null, mcp: /^mcp__/.test(name) ? annotations(name) : null });
}

/**
 * The risk said on the call's event, after a checkpoint when one covers it. Never throws: a turn is not held up by it.
 * `checkpoint: false` only reads the tier; the checkpoint then waits for keep(), which the turn calls once the call is
 * allowed — nothing is written for a call the level, the mode or a person refuses (security review 2026-10-07).
 */
async function before(name, args, { sessionId, checkpoint = true } = {}) {
  if (!on()) return null;
  try {
    const p = projectOf(sessionId);
    const r = classify(name, args, { root: p?.root || null, mcp: /^mcp__/.test(name) ? annotations(name) : null });
    const risk = { tier: r.tier, why: r.why, way: r.way };
    // Not enumerable: it never travels on an event.
    if (r.tier === 'reversible' && r.touches && p) Object.defineProperty(risk, 'pending', { value: { p, name, sessionId, way: r.way }, writable: true });
    return checkpoint ? await keep(risk) : risk;
  } catch { return null; }
}

/** The checkpoint a reversible call's risk is waiting for, taken now; the risk gains it as its way back. */
async function keep(risk) {
  const k = risk?.pending;
  if (!k) return risk;
  risk.pending = null;
  try {
    const title = require('../memory').getSession(k.sessionId)?.title || k.sessionId;
    const cp = await require('../../projects/checkpoints').take(k.p, { label: `before ${k.name} in "${String(title).slice(0, 60)}"`, sessionId: k.sessionId, by: 'panel' });
    if (cp?.id) {
      const at = `checkpoint ${cp.id} (Projects → Checkpoints)`;
      risk.checkpoint = cp.id;
      risk.way = k.way === require('./rules').WAY.project ? at : `${k.way}; ${at}`;
    }
  } catch { /* the call still runs; its way back is what classify said */ }
  return risk;
}

/** What approval.gate asks for an outward call, or null. */
function ask(name, args, ctx = {}, summarize = () => '') {
  if (!on()) return null;
  const r = ctx.risk || of(name, args, ctx);
  if (r?.tier !== 'outward') return null;
  return { tool: name, keys: null, tier: 'outward',
    summary: `${summarize(name, args)} — outward: ${r.why || 'it leaves the hive'}. There is no way back once it runs, so it is asked whatever the approval mode.` };
}

function block() {
  if (!on()) return '';
  return ['# Risk tiers', 'Each tool call is read, reversible or outward. Reads and reversible changes run (in a project a checkpoint '
    + 'is taken first); an outward call — deleting outside a project, a force-push, sending mail or a message out, paying, '
    + 'submitting, a request that sends data to a service the owner does not run — is asked of the person in every mode. '
    + 'Do what can be undone; for something untested, prefer an agents\' computer to this machine where you hold one.'].join('\n');
}

module.exports = { on, of, before, keep, ask, block };
