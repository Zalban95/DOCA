'use strict';

/**
 * Falling down the chain: which model to try next when one stalls, and
 * remembering, for a while, which ones did.
 */

const budget      = require('../budget');
const providers   = require('../providers');

/* ── Falling down the chain ───────────────────────────── */

/**
 * Which entries to try, in order, and how long to give each.
 *
 * A chain answers one question: when the configured model stops answering, who
 * answers instead. The unit of failure matters — the evening this was written
 * for, `deepseek-flash` returned `200 text/event-stream` and sent `: keep-alive`
 * for three minutes while `deepseek-v4-pro` on the same key, same account,
 * answered in 430 ms. So the thing that went quiet was the **model**, and the
 * chain has to be per model, not per provider.
 *
 * Three rules, each with a reason:
 *
 * - **The last rung gets `firstTokenTimeoutMs`, the others get
 *   `failoverAfterMs`.** Reusing the one long deadline per rung would make a
 *   three-rung chain wait three minutes before saying anything, i.e. slower
 *   than having no chain. The user's own give-up deadline is unchanged.
 * - **A rung that stalled recently goes to the back, not out.** `DEGRADED_MS`
 *   keeps the next turn from paying the same 20 s for the same silence, but the
 *   rung is still in the list, so a model that came back becomes usable again
 *   without a restart. Blacklisting would make one bad afternoon permanent.
 * - **An entry naming a provider that no longer exists is skipped, not fatal.**
 *   Deleting a provider from Settings → API Keys should narrow the chain, not
 *   break every turn.
 */
const DEGRADED_MS = 5 * 60 * 1000;
const _degraded  = new Map();                    // "provider|model" -> last stall
const rungKey    = (ep, model) => `${ep?.id || '?'}|${model || ''}`;

/** How long ago it stalled, or null if it has not, or not within `DEGRADED_MS`. */
function stalledAgo(ep, model) {
  const at = _degraded.get(rungKey(ep, model));
  if (!at) return null;
  const age = Date.now() - at;
  return age < DEGRADED_MS ? age : null;
}
const isDegraded = (ep, model) => stalledAgo(ep, model) !== null;
function markDegraded(ep, model) { _degraded.set(rungKey(ep, model), Date.now()); }
/** For tests, and for a settings change that should take effect at once. */
function forgetDegraded() { _degraded.clear(); }

function rungsFor({ ep, model, p }) {
  const chain   = Array.isArray(p?.fallbackChain) ? p.fallbackChain : [];
  const failoverMs = Number(p?.failoverAfterMs) || 0;
  const finalMs    = Number(p?.firstTokenTimeoutMs) || 0;

  const entries = [{ provider: ep.id, model, ep, contextWindow: budget.windowFor(p),
    windowSetting: p?._windowSetting || 'harness.config.doca.contextWindow' }];
  for (const [index, c] of chain.entries()) {
    const pid = String(c?.provider || '').trim();
    if (!pid) continue;
    const cModel = String(c?.model || '').trim() || model;
    // The same (provider, model) twice is a chain that waits for itself.
    if (entries.some(e => e.provider === pid && e.model === cModel)) continue;
    let cep;
    try { cep = providers.endpoint(pid); }
    catch { continue; }
    entries.push({ provider: pid, model: cModel, ep: cep,
      contextWindow: budget.windowFor(c),
      windowSetting: `harness.config.doca.fallbackChain[${index}].contextWindow` });
  }

  const warm    = entries.filter(e => !isDegraded(e.ep, e.model));
  const cold    = entries.filter(e =>  isDegraded(e.ep, e.model));
  const ordered = [...warm, ...cold];

  return ordered.map((e, i) => ({
    ...e,
    last:      i === ordered.length - 1,
    // The last one is never cut short — the user's deadline is the answer.
    timeoutMs: i === ordered.length - 1 ? finalMs : (failoverMs || finalMs),
    // How long ago it stalled, when it stalled recently enough to have been
    // moved back. The reorder above is invisible to everything downstream — it
    // happens before the lead is ever compared — so the fact has to travel with
    // the rung, or `complete` cannot report a turn that starts on the backup.
    stalledMsAgo: stalledAgo(e.ep, e.model),
  }));
}

/**
 * What a turn has to say before it starts, when the model that answers is not
 * the one the settings name.
 *
 * Two mechanisms move the lead, and both end in the same fact. A rung whose
 * declared window cannot fit the request is dropped by the preflight. A rung
 * that stalled in the last few minutes is pushed to the back of the chain, so
 * that the turns inside `DEGRADED_MS` do not each pay the same stall again —
 * see `rungsFor`.
 *
 * The second used to happen in silence: the rotation is decided before the lead
 * is compared with anything, so no `onHop` fired, and the turn arrived with no
 * row in the console, no line in the log, and no `fallbacks` on its outcome —
 * which is the only thing a client that was asleep ever sees. An answer from a
 * smaller model then reads as the configured one's, which is the exact failure
 * `onHop` exists to prevent.
 *
 * @returns {object|null} what to hand `onHop`, or null when the configured
 *   model is the one answering.
 */
function openingHop({ ep, model, candidates, rungs }) {
  const lead = rungs[0];
  if (!lead || (lead.provider === ep.id && lead.model === model)) return null;

  // The model the settings name, which is the one worth naming as the model
  // that is *not* answering, whichever way it was passed over. `rungsFor` puts
  // it in `candidates` first, so it is always there to be found.
  const configured = candidates.find(c => c.provider === ep.id && c.model === model);
  const rotated = !!candidates[0] && (candidates[0].provider !== ep.id || candidates[0].model !== model);

  return {
    from: { provider: ep.id, model, label: ep.label },
    to:   { provider: lead.provider, model: lead.model, label: lead.ep?.label },
    reason: rotated ? 'degraded' : 'context',
    seconds: rotated ? Math.round((configured?.stalledMsAgo || 0) / 1000) : 0,
    frames: 0,
    remaining: rungs.length - 1,
  };
}

/**
 * The sentence a hop is reported with, in the console row and the log line
 * alike — one wording for both, so the two cannot come to describe different
 * events.
 */
function hopText(h) {
  const to = `${h.to.label || h.to.provider}${h.to.model ? ` / ${h.to.model}` : ''}`;
  if (h.reason === 'context')
    return `${h.from.provider} / ${h.from.model} cannot fit the estimated request in its declared window; `
      + `continuing on ${h.to.provider} / ${h.to.model}.`;
  if (h.reason === 'degraded')
    return `${h.from.label || h.from.provider} stopped answering ${h.seconds}s ago and is being passed over `
      + `while it recovers; continuing on ${to}. ${h.remaining} more in the chain.`;
  return `${h.from.label || h.from.provider} stopped answering after ${h.seconds}s `
    + `(${h.from.model || 'no model'}); continuing on ${to}.`
    + (h.frames ? ` It sent ${h.frames} keep-alive frame${h.frames === 1 ? '' : 's'} and no content.` : '')
    + ` ${h.remaining} more in the chain.`;
}

/** How often a still-silent provider is reported while we wait for its first token. */

module.exports = { DEGRADED_MS, _degraded, rungKey, markDegraded, forgetDegraded, rungsFor, openingHop, hopText };
