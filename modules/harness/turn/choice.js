'use strict';

/**
 * The model a conversation runs on, chosen in the chat — above all while
 * coding, where one job wants the strong model and the next a quick one.
 *
 * Kept on the session row as `modelChoice: { provider, model, fallback }`:
 *   - no choice: the harness's own model and fallback chain, as before;
 *   - a model: this conversation starts every turn on it;
 *   - fallback on (the default): when it stops answering, the turn goes on down
 *     the harness's order — the primary, then the fallback chain — from the
 *     entry after the chosen one; a model not in that order is followed by the
 *     whole order;
 *   - fallback off: the chosen model alone, and a stall is reported, not hopped.
 * The saved harness settings are never changed: this is the turn's own copy.
 */
const memory = require('../memory');

/** The harness's order: its model, then each fallback, as { provider, model, contextWindow }. */
function order(p) {
  const head = { provider: p.provider, model: p.model, contextWindow: Number(p.contextWindow) || 0 };
  const chain = (Array.isArray(p.fallbackChain) ? p.fallbackChain : [])
    .filter(e => e?.provider).map(e => ({ provider: e.provider, model: e.model || p.model, contextWindow: Number(e.contextWindow) || 0 }));
  return [head, ...chain];
}

/** The turn's parameters with the conversation's choice applied. */
function apply(p, sessionId) {
  let s = null;
  try { s = memory.getSession(sessionId || memory.activeSession()?.id); } catch { /* no session yet */ }
  const pick = s?.modelChoice;
  if (!pick || (!pick.model && pick.fallback !== false)) return p;
  const list = order(p);
  const at = pick.model ? list.findIndex(e => e.provider === pick.provider && e.model === pick.model) : 0;
  const head = at >= 0 ? list[at] : { provider: pick.provider, model: pick.model, contextWindow: 0 };
  const rest = at >= 0 ? list.slice(at + 1) : list;
  return {
    ...p,
    provider: head.provider, model: head.model, contextWindow: head.contextWindow,
    _windowSetting: at > 0 ? `harness.config.doca.fallbackChain[${at - 1}].contextWindow` : at === 0 ? p._windowSetting : 'unknown for a model outside the harness order',
    fallbackChain: pick.fallback === false ? [] : rest,
    _choice: { provider: head.provider, model: head.model, fallback: pick.fallback !== false },
  };
}

/** Set or clear a conversation's choice. `model` empty clears it (fallback may still be switched off). */
function set(sessionId, { provider, model, fallback } = {}) {
  const s = memory.getSession(sessionId);
  if (!s) throw Object.assign(new Error('Unknown conversation'), { status: 404 });
  const m = String(model || '').trim(), pr = String(provider || '').trim();
  if (m && !pr) throw Object.assign(new Error('A model needs its provider.'), { status: 400 });
  if (pr) require('../providers').endpoint(pr);   // an unknown provider is refused here, not at the next turn
  const choice = m || fallback === false ? { provider: m ? pr : null, model: m || null, fallback: fallback !== false } : null;
  memory.updateSession(sessionId, { modelChoice: choice });
  return choice;
}

/** What the chat's picker shows: the harness's order, this conversation's choice, and what a turn would use. */
function view(sessionId) {
  const p = require('./params').params();
  const s = memory.getSession(sessionId);
  if (!s) throw Object.assign(new Error('Unknown conversation'), { status: 404 });
  const used = apply(p, sessionId);
  return { order: order(p), choice: s.modelChoice || null,
    effective: { provider: used.provider, model: used.model, fallback: order(used).slice(1).map(e => `${e.provider}/${e.model}`) } };
}

module.exports = { order, apply, set, view };
