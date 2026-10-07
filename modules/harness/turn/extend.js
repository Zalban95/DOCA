'use strict';

/**
 * A turn that reaches its last step while still getting somewhere carries on (experiment `adaptiveLimits`,
 * docs/experiments/adaptive-limits.md; TODO H10.6). Stopping a turn that is advancing only makes the person say
 * "go on" and start a cold one; stopping a turn that is going round in circles is what the step limit is for. So the
 * test is evidence of progress, read from what the turn already recorded:
 *
 *   - no call failed the same way three times this turn (turn/failures.js — the supervisor's failure loop), and
 *   - a step of the conversation's plan closed during this turn, or the last two steps' tool calls all succeeded and
 *     were not the same calls again (a poll going round is not progress).
 *
 * Each extension adds the turn's base (`maxSteps`) up to the owner's ceiling, and says why.
 */
const failures = require('./failures');
const { openPlanSteps } = require('./triage');

/** The tool steps written since `from`: [{ calls: [name+args], failed: n }], oldest first. */
function stepsSince(rows, from) {
  const out = [];
  for (const r of rows.slice(from)) {
    if (r.role === 'assistant' && Array.isArray(r.tool_calls) && r.tool_calls.length)
      out.push({ calls: r.tool_calls.map(c => `${c.function?.name}\u0000${c.function?.arguments || ''}`).sort(), failed: 0, results: 0 });
    else if (r.role === 'tool' && out.length) {
      const last = out[out.length - 1];
      last.results++;
      if (r.failure || failures.classify(r.content)) last.failed++;
    }
  }
  return out;
}

/**
 * Whether the turn is advancing: { ok, why }. `planOpenAtStart` is the plan's open steps when the turn began, so a
 * step closed during the turn counts; `loop` is failures.looped() for the turn.
 */
function advancing({ rows, from = 0, loop = null, planOpenAtStart = 0, session = null }) {
  if (loop) return { ok: false, why: `${loop.tool} failed the same way ${loop.times} times (${loop.kind})` };
  const closed = planOpenAtStart - openPlanSteps(session);
  if (closed > 0) return { ok: true, why: `${closed} step${closed === 1 ? '' : 's'} of the plan closed this turn` };
  const steps = stepsSince(rows, from);
  if (steps.length < 2) return { ok: false, why: 'not enough steps to tell' };
  const [a, b] = steps.slice(-2);
  if (a.failed || b.failed) return { ok: false, why: 'a call in the last two steps failed' };
  if (a.calls.join('\n') === b.calls.join('\n')) return { ok: false, why: 'the last two steps made the same calls' };
  return { ok: true, why: 'the last two steps\' calls all succeeded, each doing something new' };
}

/**
 * At the turn's last step: the new budget and why — { to, why } — or null to stop as before. `v` is the triage's
 * verdict (null when the experiment is off: never extended).
 */
function extension({ v, step, budget, rows, from, loop, planOpenAtStart, session }) {
  if (!v || step < budget || budget >= v.ceiling) return null;
  const a = advancing({ rows, from, loop, planOpenAtStart, session });
  if (!a.ok) return null;
  return { to: Math.min(v.ceiling, budget + v.base), why: a.why };
}

/** The warning a person and the trace read. */
const warning = (x, step, ceiling) => ({ type: 'warning', step, kind: 'extended', to: x.to, why: x.why,
  text: `Still advancing at step ${step} (${x.why}): extended to ${x.to} steps, up to limits.maxStepsCeiling (${ceiling}) — experiment adaptiveLimits.` });

/** For agent.js, at the turn's last step: the new budget (announced) or null. */
function atLimit({ v, step, budget, sessionId, from, signal, planOpenAtStart, say }) {
  if (!v) return null;
  const memory = require('../memory');
  const x = extension({ v, step, budget, rows: memory.messages(sessionId), from, loop: failures.looped(signal), planOpenAtStart, session: memory.getSession(sessionId) });
  if (!x) return null;
  say(warning(x, step, v.ceiling));
  return x.to;
}

module.exports = { stepsSince, advancing, extension, warning, atLimit };
