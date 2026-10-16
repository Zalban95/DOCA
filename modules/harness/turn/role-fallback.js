'use strict';

/**
 * A role's model that fails does not fail the turn (round 1 of the test of 2026-10-16).
 *
 * The mastermind (turn/model-route.js) was refused on every call — its provider would not take the reply cap the
 * worker took — so every mastermind step failed, the turn failed, and every later message in that conversation failed
 * at once, since a new message is the mastermind's first step. A role is a refinement of the turn's own model, never a
 * condition for answering: when the role's model fails in a way its own fallback chain did not absorb (a refusal, a
 * failed login, a rate limit waited out too long), the step is asked again of the turn's own model — the harness's
 * model and its fallback chain — and said once, with a `warning` of kind `role-fallback` naming the role, the model and
 * the reason. For the rest of the turn that role's steps go to the turn's own model too (`led.roleFailed`), so a
 * refusal is paid once a turn, not once a step. A Stop is never a failure and is passed on as it is.
 */
const { withoutEcho } = require('./messages');

const same = (a, b) => a.provider === b.provider && a.model === b.model;

/**
 * Run one step's call, `run(p, ep, fixMessages)`, as the routed role; on failure, once more as the turn's own model.
 * `r` is model-route.step's answer and is updated to whichever model answered.
 */
async function call({ r, p, ep, led, say, step, signal }, run) {
  if (!r.role || same(r.p, p)) return run(r.p, r.ep, m => m);
  try {
    return await run(r.p, r.ep, m => m);
  } catch (e) {
    if (signal?.aborted || e?.name === 'AbortError') throw e;
    const reason = String(e?.message || e).replace(/\s+/g, ' ').trim().slice(0, 400).replace(/[.\s]+$/, '');
    const failed = { provider: r.p.provider, model: r.p.model, reason };
    (led.roleFailed ||= {})[r.role] = failed;
    say({ type: 'warning', step, kind: 'role-fallback', role: r.role, provider: failed.provider, model: failed.model,
      text: `The ${r.role}'s model (${failed.provider}/${failed.model}, harness.models.${r.role}) failed: ${reason} — `
        + `this step and the ${r.role}'s steps for the rest of this turn are asked of the harness's own model (${p.provider}/${p.model}).` });
    const from = r.ep;
    r.p = { ...p, _role: r.role, _roleSkipped: 'failed this turn' };
    r.ep = ep;
    // The messages were built for the role's provider: what only it asked for (its reasoning echo) comes out.
    return run(r.p, r.ep, m => (from?.id !== ep?.id ? withoutEcho(m) : m));
  }
}

module.exports = { call };
