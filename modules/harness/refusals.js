'use strict';

/**
 * A provider's refusal, or its silence, as a sentence that names the limit and
 * says whose it is (charter rule 12). Moved out of budget.js, which re-exports
 * both functions, so `budget.explain` and `budget.stalled` still work.
 */

/* ── When the provider says no ─────────────────────────── */

const CONTEXT_ERROR  = /context[ _-]?(length|window)|maximum context|too many tokens|reduce the length|prompt is too long|exceeds? the (model|context)/i;
const RATE_ERROR     = /rate[ _-]?limit|too many requests|quota|insufficient[_ ]quota|billing/i;
const AUTH_ERROR     = /invalid[ _-]?api[ _-]?key|unauthor|forbidden|authentication/i;

/**
 * Turn a provider's refusal into a sentence that names the limit and says whose
 * it is. The vendor's own text is kept — it is often the only place the real
 * number appears — but it stops being the whole message.
 */
function explain({ status, detail, ep, p }) {
  const body  = String(detail || '').slice(0, 400);
  const who   = ep?.id || 'the provider';
  const head  = `${who} refused this call (HTTP ${status})`;
  const tail  = body ? `\n\nWhat ${who} said: ${body}` : '';

  if (status === 429 || RATE_ERROR.test(body))
    return `${head}: a rate or quota limit. That one is ${who}'s, not a DOCA setting — waiting or a different `
      + `provider is the only thing that changes it.${tail}`;

  if (status === 401 || status === 403 || AUTH_ERROR.test(body))
    return `${head}: the key was rejected. Set it in Field → API keys; DOCA never stores it in prefs.${tail}`;

  if (CONTEXT_ERROR.test(body) || status === 413) {
    const window = require('./budget').windowFor(p);
    return `${head}: the prompt was longer than the model's context window`
      + `${window ? ` (this harness is configured for ${window} tokens — if the model's real window is smaller, `
        + 'that setting is wrong)' : ' (no context window is configured for this harness, so it could not warn you)'}. `
      + 'The DOCA settings that decide how much is sent are harness.config.doca.historyTurns, .summarizeAfter, '
      + `.compactTokens and .memoryLimit; the window itself is ${who}'s.${tail}`;
  }

  return `${head}.${tail}`;
}

/**
 * The message for a provider that accepted the request and then never answered.
 *
 * This is not a refusal — there is no status and no vendor text to quote, which
 * is exactly what makes it hard to read. So it has to say all four things
 * itself: who went quiet, for how long, whose limit stopped the waiting, and
 * what to do. Charter rule 12 in the one case where the provider says nothing
 * at all.
 */
function stalled({ ep, ms, frames, setting = 'firstTokenTimeoutMs' }) {
  const who     = ep?.label || ep?.id || 'the provider';
  const seconds = Math.round((Number(ms) || 0) / 1000);
  const held    = frames > 0
    ? ` It sent ${frames} keep-alive frame${frames === 1 ? '' : 's'} and no content, which is a provider holding a `
      + 'queued request open rather than a network fault.'
    : '';

  // The limit that fired: failoverAfterMs on every rung but the last (audit 2026-10-04: it always said the other one).
  return `${who} held the connection open for ${seconds}s without sending a token — that is this panel's `
    + `${setting}, not the model's. Raise it in harness settings `
    + `(harness.config.doca.${setting}), or try another provider or model.`
    + held
    + ' Nothing was cancelled at the provider\'s end: this stopped the waiting, not the work, so anything it was '
    + 'about to charge for it may still charge for.';
}

module.exports = { explain, stalled, CONTEXT_ERROR, RATE_ERROR, AUTH_ERROR };
