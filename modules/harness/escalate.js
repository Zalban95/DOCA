'use strict';

/**
 * A stuck job gets one try on a stronger model before it is called blocked
 * (TODO.md, "Failure needs a structured shape": retry → escalate → block).
 *
 * "Stuck" is what the supervisor already decides mechanically: the same call
 * failing the same way in a turn (`failures.looped`), or automatic turns in a
 * row that did nothing. Before this, both went straight to `blocked`/`stalled`
 * and woke the Orchestrator, which was right for a job the model could not do
 * and wasteful for one a stronger model could.
 *
 * - **Off until somebody names the model** (`harness.config.doca.escalateTo`,
 *   `{ provider, model }`). Which model is stronger is not something the panel
 *   can know, and an escalation is a cost decision, so it is never guessed.
 * - **Once per job.** The escalated try is marked on the job; stuck again, the
 *   job is blocked as before, and the report says the stronger model was tried.
 *   A new task is a new job (organization.send) and may escalate again.
 * - **Visible.** It is the conversation's own model choice (turn/choice.js),
 *   so the chat's model picker shows it, and the Orchestrator gets a progress
 *   report naming both models. It is left in place for the rest of the job —
 *   one turn on a stronger model rarely finishes what the weaker one could not
 *   start — and the person can switch it back in the picker.
 * - Running out of `autoTurnsPerJob` is not "stuck"; it is the budget, and it
 *   still stops the job.
 */

const memory = require('./memory');

/** The configured stronger model, or null when escalation is off. */
function target(p) {
  const e = p?.escalateTo;
  return e && typeof e === 'object' && String(e.provider || '').trim()
    ? { provider: String(e.provider).trim(), model: String(e.model || '').trim() || p.model }
    : null;
}

/**
 * Move a stuck job to the stronger model, if that is still possible. Returns the
 * wake message for its next turn, or null (off, already tried, already on it, or
 * the provider is gone) — in which case the caller blocks the job as before.
 */
function tryEscalate(s, why, p) {
  const to = target(p);
  if (!to || s.job?.escalated) return null;
  const current = require('./turn/choice').apply(p, s.id);
  if (current.provider === to.provider && current.model === to.model) return null;
  try {
    require('./turn/choice').set(s.id, { provider: to.provider, model: to.model, fallback: true });
  } catch (e) {
    console.warn(`[escalate] ${s.id}: ${e.message}`);
    return null;
  }
  memory.updateSession(s.id, { job: { ...s.job, state: 'working', idleTurns: 0,
    escalated: { from: `${current.provider}/${current.model}`, to: `${to.provider}/${to.model}`, why, at: new Date().toISOString() } } });
  require('./organization').report(s.id, 'progress', `Escalated: ${why}. Trying once on ${to.provider}/${to.model} `
    + `instead of ${current.provider}/${current.model} (harness.config.doca.escalateTo).`, 'panel');
  return `[panel] You were stuck: ${why}. This conversation now runs on ${to.provider}/${to.model}, a stronger model, `
    + 'for one more try. Look at the problem again from the start rather than repeating the last approach. '
    + 'If it cannot be done, say so: work_chats report with outcome blocked and what is in the way.';
}

/** A sentence for the blocked report, saying whether the stronger model was already tried. */
function note(s) {
  const e = s.job?.escalated;
  return e ? ` It had already been moved to ${e.to} for one more try.` : '';
}

module.exports = { target, tryEscalate, note };
