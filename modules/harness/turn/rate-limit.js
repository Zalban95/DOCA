'use strict';

/**
 * Waiting out a rate limit (TODO.md, "Where this harness stands…" §8).
 *
 * A 429 used to end the turn — or a whole mission — on the first refusal, when
 * the provider was saying "not this second" rather than "no". It is retried now,
 * on the same rung, a bounded number of times, and never quietly:
 *
 * - **A refused request costs nothing.** The provider did not accept it, so a
 *   retry cannot charge twice. That was the open worry in §8, and it is why a
 *   429 is retried while a stall (which may still be billing) is not.
 * - **Every wait is announced** through `onRetry`, with how long, which attempt,
 *   and which two settings bound it — a turn that goes quiet for thirty seconds
 *   reads as a hang otherwise.
 * - **A quota is not a rate.** "insufficient_quota" or a billing message is the
 *   provider saying the account is out; waiting changes nothing, so it fails at
 *   once, as before.
 * - **The provider's own Retry-After wins over our backoff**, and a wait longer
 *   than `rateLimitMaxWaitMs` is not attempted at all: the turn fails and says
 *   how long it was asked to wait.
 * - It does not move down the fallback chain. That was decided 2026-09-18 and
 *   still holds: a rate limit is an answer about this account, and hopping
 *   would hide it.
 */

const QUOTA = /insufficient[_ ]quota|exceeded your current quota|billing|credit balance|payment required|out of credits/i;
const BASE_MS = 2000;

/** Milliseconds from Retry-After (seconds or an HTTP date) or retry-after-ms; null when absent. */
function retryAfterMs(headers) {
  const get = k => headers?.get?.(k) ?? null;
  const ms = Number(get('retry-after-ms'));
  if (get('retry-after-ms') !== null && Number.isFinite(ms) && ms >= 0) return ms;
  const raw = get('retry-after');
  if (raw === null || raw === '') return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

function limits(p) {
  const tries = p?.rateLimitRetries === undefined ? 2 : Math.max(0, Number(p.rateLimitRetries) || 0);
  const cap = Number(p?.rateLimitMaxWaitMs) > 0 ? Number(p.rateLimitMaxWaitMs) : 60000;
  return { tries, cap };
}

/**
 * What to do about an error on attempt `attempt` (0-based count of retries
 * already made): `null` (not ours — rethrow), `{ waitMs }` (wait and retry), or
 * `{ giveUp: true, waitMs }` (the provider asked for longer than we wait).
 */
// OpenRouter's 402 when credit is held by requests still in flight ("Retry after in-flight requests complete"): it passes
// as they finish, so it is waited out like a rate limit — an empty balance (QUOTA's words) still is not (2026-10-17).
const IN_FLIGHT = /in-flight|in flight/i;

function plan(e, attempt, p) {
  const status = Number(e?.status), msg = String(e?.message || '');
  if (!(status === 429 && !QUOTA.test(msg)) && !(status === 402 && IN_FLIGHT.test(msg))) return null;
  const { tries, cap } = limits(p);
  if (attempt >= tries) return null;
  const hinted = Number.isFinite(e?.retryAfterMs) ? e.retryAfterMs : null;
  if (hinted !== null && hinted > cap) return { giveUp: true, waitMs: hinted };
  const waitMs = hinted !== null ? hinted : Math.min(cap, BASE_MS * 2 ** attempt + Math.floor(Math.random() * 250));
  return { waitMs, hinted: hinted !== null, attempt: attempt + 1, tries, status };
}

function notice({ who, model, waitMs, attempt, tries, hinted, status = 429 }) {
  const what = status === 402 ? 'holds this request until its requests in flight finish (HTTP 402: credit reserved for them)' : 'is rate-limiting this panel (HTTP 429)';
  return `${who}${model ? ` / ${model}` : ''} ${what}. Waiting ${Math.ceil(waitMs / 1000)}s`
    + `${hinted ? ', as it asked,' : ''} and trying again (${attempt} of ${tries}). The limit is ${who}'s; how many times `
    + 'and how long this panel waits are harness.config.doca.rateLimitRetries and .rateLimitMaxWaitMs. '
    + 'A refused request is not charged, so this does not cost twice.';
}

function tooLong(e, waitMs, p) {
  e.message += `\n\n${e.message.includes('HTTP 429') ? 'It' : 'The provider'} asked to wait ${Math.ceil(waitMs / 1000)}s, `
    + `longer than this panel waits (harness.config.doca.rateLimitMaxWaitMs = ${limits(p).cap} ms), so it was not retried.`;
  return e;
}

/** Resolves after `ms`, or rejects at once with the signal's reason when it aborts. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(t); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

module.exports = { plan, notice, tooLong, sleep, retryAfterMs, limits, QUOTA };
