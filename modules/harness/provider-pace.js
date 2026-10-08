'use strict';

/**
 * A local model's own pace: how long to wait for its first token, and how long a reply it may write (deep test A,
 * #7). The harness's defaults — `firstTokenTimeoutMs` 90 s, "Longest reply" — are shaped for a hosted model. A model on
 * this machine or the LAN, connected through Set-up or Field → API keys, failed its first turns on them: a long prompt
 * on one slot took more than 90 s to start, and a tool call was cut at the reply limit. Every tester raised both by
 * hand before anything worked.
 *
 * So when such a provider is added or chosen for the agent, its server is asked what it is — llama.cpp's `/props`
 * (`n_ctx`, `total_slots`), else the window any other local server reports (context-window.js: vLLM, LM Studio,
 * Ollama) — and the provider gets values of its own, kept beside its contract (store `harness/provider-pace`):
 *
 *   firstTokenTimeoutMs   a full window read at ~200 tokens a second, 2–10 minutes; 5 minutes when nothing says
 *   maxTokens             a quarter of its window, 8192–16384; 8192 when nothing says
 *
 * They stand in for the harness's defaults only (`apply`): a value the person set — "Longest reply" raised or
 * lowered, a specialist's own — still wins, and a hosted provider is untouched. The busy-server extension
 * (turn/busy-server.js) still stretches the wait while the server is visibly at work. Shown with where each came
 * from: Field → API keys (the provider's row) and Set-up's "Use it for DOCA's agent".
 */
const store = require('../store');

const DOC = 'harness/provider-pace';
const PREFILL_PER_S = 200;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : null);
const root = base => String(base).replace(/\/+$/, '').replace(/\/v1$/, '');

const all = () => store.readJson(DOC, { providers: {} }).providers;

/** The values for a server that reported `ctx` tokens of window and `slots` slots (either may be null). */
function valuesFor({ ctx, slots } = {}) {
  const wait = ctx ? clamp(Math.ceil(ctx / PREFILL_PER_S) * 1000, 120000, 600000) : 300000;
  return {
    // One slot means a request may also wait for the one before it to finish.
    firstTokenTimeoutMs: slots === 1 ? Math.min(600000, wait + 60000) : wait,
    maxTokens: ctx ? clamp(Math.floor(ctx / 4), 8192, 16384) : 8192,
  };
}

async function getJson(url, apiKey, fetchImpl) {
  const r = await fetchImpl(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/**
 * Asks a local provider's server and keeps its pace; null (and nothing kept) for a hosted one, or an unknown id.
 * @returns {Promise<{firstTokenTimeoutMs, maxTokens, from, at}|null>}
 */
async function measure(provider, { model, fetchImpl = fetch } = {}) {
  let ep;
  try { ep = require('./providers').endpoint(provider); } catch { return null; }
  if (!ep.local) return null;
  let ctx = null, slots = null, from = null;
  try {
    const props = await getJson(`${root(ep.baseUrl)}/props`, ep.apiKey, fetchImpl);
    ctx = num(props?.default_generation_settings?.n_ctx) || num(props?.n_ctx);
    slots = num(props?.total_slots);
    if (ctx || slots) from = `llama.cpp /props: ${ctx ? `${ctx} tokens of context` : 'no context size'}${slots ? `, ${slots} slot${slots === 1 ? '' : 's'}` : ''}`;
  } catch { /* not llama.cpp */ }
  if (!ctx && model) {
    const w = await require('./context-window').discover(ep.id, model).catch(() => null);
    if (w?.tokens) { ctx = w.tokens; from = w.source; }
  }
  const pace = { ...valuesFor({ ctx, slots }), from: from || 'a model on this machine or the local network (its server said nothing about its size)', at: new Date().toISOString() };
  const doc = store.readJson(DOC, { providers: {} });
  doc.providers[ep.id] = pace;
  store.writeJson(DOC, doc);
  return pace;
}

/** The kept pace of one provider, or null. */
const of = provider => all()[provider] || null;

/** `measure` once: what is kept, else asked now. */
async function ensure(provider, opts) {
  return of(provider) || measure(provider, opts);
}

/** For the agent's config route: a provider just chosen is asked once, and its pace said ({} when none). */
async function chosen(body, config) {
  if (!body?.provider || !config?.provider) return {};
  const pace = await ensure(config.provider, { model: config.model }).catch(() => null);
  return pace ? { pace, paceText: sentence(pace) } : {};
}

/**
 * The turn's parameters with its provider's pace in place of the harness's defaults. A value the person set — the
 * harness's own, or a specialist's — is theirs and wins (catalog keeps only what differs from the defaults).
 */
function apply(p) {
  const pace = p?.provider && of(p.provider);
  if (!pace) return p;
  const d = require('./providers').defaultParams();
  const take = k => (Number(p[k]) === Number(d[k]) ? pace[k] : p[k]);
  return { ...p, firstTokenTimeoutMs: take('firstTokenTimeoutMs'), maxTokens: take('maxTokens'), _pace: pace };
}

/** One line for a person: what it waits and writes, and why. */
function sentence(pace) {
  if (!pace) return '';
  return `waits up to ${Math.round(pace.firstTokenTimeoutMs / 60000 * 10) / 10} min for a first token and writes replies up to ${pace.maxTokens} tokens — from ${pace.from}`;
}

function forget(provider) {
  const doc = store.readJson(DOC, { providers: {} });
  if (!doc.providers[provider]) return;
  delete doc.providers[provider];
  store.writeJson(DOC, doc);
}

module.exports = { valuesFor, measure, ensure, chosen, of, apply, sentence, forget, all };
