'use strict';

/**
 * What a turn costs, and which limit is about to stop it.
 *
 * Before this, nothing in the harness counted anything. The limits that existed
 * were all counts of *messages* — `historyTurns`, `summarizeAfter` — which say
 * nothing about size: twenty-four rows of `find` output and twenty-four lines of
 * chat are the same number and three orders of magnitude apart. So the thing
 * that actually stopped a long turn was the provider answering 400, surfaced as
 * four hundred characters of somebody else's JSON. A limit nobody can name is
 * indistinguishable from a bug, and the user pays for the difference in
 * debugging time.
 *
 * Two rules follow from that, and they are the whole design:
 *
 *   1. Every stop names its limit and says who set it — a DOCA setting the
 *      agent can propose changing, or the provider's own, which it cannot.
 *   2. A limit warns on the way up. Advisory first, at `warnAt` percent; the
 *      hard stop is the provider's and arrives without asking.
 *
 * Usage is taken from the provider when it reports any (`usage` on the
 * completion, or the final frame of a stream when `stream_options.include_usage`
 * was accepted) and estimated otherwise, because a local llama.cpp may report
 * nothing at all and "unknown" would make the whole ledger useless. Estimates
 * are marked as estimates everywhere they surface: a number the user cannot
 * tell from a measurement is worse than no number.
 */

/**
 * Characters per token. Deliberately crude — this is a fallback, and the cost of
 * being 15% wrong about a warning threshold is nothing next to the cost of
 * pretending not to know how big the context is. English prose and code both sit
 * near four; the estimate errs low on JSON, which is why the thresholds warn
 * well before the wall.
 */
const CHARS_PER_TOKEN = 4;

function estimate(text) {
  return Math.ceil(String(text ?? '').length / CHARS_PER_TOKEN);
}

/** What one API message array is about to cost, near enough to act on. */
function estimateMessages(messages) {
  let chars = 0;
  for (const m of messages || []) {
    chars += String(m.content || '').length + String(m.role || '').length + 4;
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
    if (m.name) chars += m.name.length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** The window this harness believes it has, or 0 when nobody has said. */
function windowFor(p) {
  const n = Number(p?.contextWindow);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Absolute prompt size at which older messages fold, or 0 when unset. */
function compactTokensFor(p) {
  const n = Number(p?.compactTokens);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Should this prompt fold now?
 *
 * Two independent triggers: an absolute token budget (works with no window
 * declared) and a percentage of a declared window. Either is enough.
 */
function shouldCompact(p, lastPrompt) {
  return !!compactReason(p, lastPrompt);
}

/**
 * Which setting made this prompt fold, or null. The log used to print the
 * prompt against the window ("47688 of 1000000"), which reads as folding at 5%
 * for no reason when the trigger was `compactTokens` at 40000 all along.
 */
function compactReason(p, lastPrompt) {
  const prompt = Number(lastPrompt) || 0;
  const budgetTok = compactTokensFor(p);
  if (budgetTok && prompt >= budgetTok) return { setting: 'compactTokens', at: budgetTok };
  const window = windowFor(p);
  const pctAt = Math.max(1, Number(p.compactAt) || 60);
  if (window && prompt / window * 100 >= pctAt)
    return { setting: 'compactAt', at: Math.round(window * pctAt / 100) };
  return null;
}

function pct(value, total) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

/** A fresh ledger for one turn. */
function ledger() {
  return {
    steps: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    lastPrompt: 0,          // the prompt of the most recent step — what fills the window
    peakPrompt: 0,
    cachedTokens: 0,        // prompt tokens the provider served from its prefix cache
    cacheReported: false,   // did it tell us about caching at all?
    measured: false,        // did any provider actually tell us?
    estimated: false,       // did we have to guess for any step?
  };
}

/**
 * Record one model call. `usage` is the provider's if it sent one; the
 * estimates are used only for the parts it left out.
 */
/**
 * Cached prompt tokens, however this provider spells them.
 *
 * Every provider worth using caches a stable prompt prefix and bills a re-send
 * at a fraction of the first one — which is the entire reason `environment.js`
 * keeps its volatile readings last. But they each report it differently, and
 * reading none of them means the panel shows raw prompt tokens and calls it
 * spend. An eleven-step turn then reads as 1.6 million when most of it was the
 * same prefix arriving again at a tenth of the price. That is the same class of
 * mistake as a failed check reporting "up to date": a number stated without
 * saying what kind of number it is.
 */
function cachedOf(usage) {
  const n = v => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
  return n(usage?.prompt_cache_hit_tokens)              // DeepSeek
    ?? n(usage?.prompt_tokens_details?.cached_tokens)   // OpenAI
    ?? n(usage?.cache_read_input_tokens)                // Anthropic-compatible
    ?? null;
}

function record(l, { usage, promptEstimate = 0, completionEstimate = 0 } = {}) {
  const measuredPrompt     = Number(usage?.prompt_tokens);
  const measuredCompletion = Number(usage?.completion_tokens);
  const havePrompt     = Number.isFinite(measuredPrompt) && measuredPrompt > 0;
  const haveCompletion = Number.isFinite(measuredCompletion) && measuredCompletion >= 0;

  const prompt     = havePrompt     ? measuredPrompt     : promptEstimate;
  const completion = haveCompletion ? measuredCompletion : completionEstimate;

  l.steps            += 1;
  l.promptTokens     += prompt;
  l.completionTokens += completion;
  l.totalTokens       = l.promptTokens + l.completionTokens;
  l.lastPrompt        = prompt;
  l.peakPrompt        = Math.max(l.peakPrompt, prompt);

  const cached = cachedOf(usage);
  if (cached !== null) { l.cachedTokens += Math.min(cached, prompt); l.cacheReported = true; }
  if (havePrompt || haveCompletion) l.measured  = true;
  if (!havePrompt || !haveCompletion) l.estimated = true;
  return l;
}

/** The ledger as a client should draw it. */
function report(l, p) {
  const window = windowFor(p);
  return {
    steps: l.steps,
    promptTokens: l.promptTokens,
    completionTokens: l.completionTokens,
    totalTokens: l.totalTokens,
    contextTokens: l.lastPrompt,
    contextWindow: window || null,
    contextPercent: window ? pct(l.lastPrompt, window) : null,
    source: l.measured ? (l.estimated ? 'mixed' : 'provider') : 'estimated',
    // Reported separately rather than subtracted: the tokens really were sent,
    // and a panel that quietly showed a smaller number would be lying in the
    // other direction. What changes is what they cost.
    cachedTokens: l.cacheReported ? l.cachedTokens : null,
    cachePercent: l.cacheReported && l.promptTokens
      ? pct(l.cachedTokens, l.promptTokens) : null,
  };
}

/**
 * Is the window filling up? Returns the advisory, or null while there is room.
 *
 * Only ever advisory. Nothing here stops a turn — the point is that the user
 * and the agent both see it coming, and that the number they see says whether
 * it was measured or guessed.
 */
function warning(l, p) {
  const window = windowFor(p);
  if (!window) return null;
  const at = Math.min(99, Math.max(1, Number(p.warnAt) || 80));
  const used = pct(l.lastPrompt, window);
  if (used < at) return null;
  return {
    kind: 'context',
    percent: used,
    tokens: l.lastPrompt,
    window,
    estimated: !l.measured,
    text: `Context is ${used}% full (${l.lastPrompt} of ${window} tokens`
      + `${l.measured ? '' : ', estimated'}). Older messages fold into the summary as this rises; `
      + 'if the answer needs everything at once, finish it now rather than starting new work.',
  };
}

/**
 * What the agent is told about its own limits, every turn.
 *
 * It is told the settings by name and by dotted path, because the one thing it
 * can do about a limit is propose changing it, and `settings_propose` wants the
 * path. Limits it cannot change are marked as such so it does not waste a
 * proposal — and, more importantly, so it does not tell the user to change
 * something that is not theirs to change.
 */
function block(p, l) {
  const window = windowFor(p);
  const out = ['# Your limits'];

  out.push(window
    ? `context window: ${window} tokens (setting harness.config.doca.contextWindow — what the model actually `
      + 'accepts is the provider\'s, this is only what you were told it is)'
    : 'context window: not declared. Nobody has told this harness how big the model\'s window is. '
      + (compactTokensFor(p)
        ? 'Older messages still fold once the prompt reaches harness.config.doca.compactTokens.'
        : 'It would compact on message count alone. If you learn the real figure, propose it as '
          + 'harness.config.doca.contextWindow.'));

  out.push(
    `reply cap: ${Number(p.maxTokens) > 0 ? `${p.maxTokens} tokens` : 'none set'} (harness.config.doca.maxTokens)`,
    `tool steps: ${p.maxSteps} per turn (harness.config.doca.maxSteps)`,
    `history kept verbatim: ${p.historyTurns} messages, older ones fold into the summary after `
      + `${p.summarizeAfter} messages or ${compactTokensFor(p) || '(unset)'} tokens of prompt `
      + `(harness.config.doca.historyTurns, .summarizeAfter, .compactTokens)`,
    `memory entries in this prompt: up to ${p.memoryLimit} (harness.config.doca.memoryLimit)`,
  );

  if (l && l.steps) {
    const r = report(l, p);
    out.push('', `this turn so far: ${r.steps} model call${r.steps === 1 ? '' : 's'}, `
      + `${r.totalTokens} tokens (${r.source})`
      + (r.cachePercent !== null ? `, ${r.cachePercent}% of the prompt served from cache` : '')
      + (r.contextPercent !== null ? `, last prompt ${r.contextTokens} = ${r.contextPercent}% of the window` : ''));
  }

  out.push('',
    'These are settings on this panel, not the provider\'s. Propose a change when one of them is what is in your '
    + 'way, and say which it is — never stop with "I ran out" and leave the user to guess which limit it was.');

  return out.join('\n');
}

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
    return `${head}: the key was rejected. Set it in Settings → API Keys; DOCA never stores it in prefs.${tail}`;

  if (CONTEXT_ERROR.test(body) || status === 413) {
    const window = windowFor(p);
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
function stalled({ ep, ms, frames }) {
  const who     = ep?.label || ep?.id || 'the provider';
  const seconds = Math.round((Number(ms) || 0) / 1000);
  const held    = frames > 0
    ? ` It sent ${frames} keep-alive frame${frames === 1 ? '' : 's'} and no content, which is a provider holding a `
      + 'queued request open rather than a network fault.'
    : '';

  return `${who} held the connection open for ${seconds}s without sending a token — that is this panel's `
    + 'firstTokenTimeoutMs, not the model\'s. Raise it in harness settings '
    + '(harness.config.doca.firstTokenTimeoutMs), or try another provider or model.'
    + held
    + ' Nothing was cancelled at the provider\'s end: this stopped the waiting, not the work, so anything it was '
    + 'about to charge for it may still charge for.';
}

module.exports = {
  CHARS_PER_TOKEN,
  estimate, estimateMessages, windowFor, compactTokensFor, shouldCompact, compactReason,
  ledger, record, report, warning, block, explain, stalled,
};
