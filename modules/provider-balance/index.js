'use strict';

/**
 * What a provider itself says about spend or balance, shown beside DOCA's own count in Field → API keys (asked
 * 2026-10-16). One small file per provider's dialect; a provider without one shows DOCA's count alone.
 *
 * The key stays here: it is sent only to the dialect's own origin, and only when the provider's address is that origin
 * (a key kept for another address is never sent there); redirects are refused; the answer is reduced to figures, so
 * no key or account detail reaches the browser. Kept five minutes per provider, and asked only when the page asks.
 */
const DIALECTS = [require('./openrouter'), require('./deepseek')];
const TTL_MS = 5 * 60 * 1000;
const cache = new Map();   // provider id → { at, value }

const originOf = url => { try { return new URL(url).origin; } catch { return null; } };

/** The dialect for a provider whose address is that dialect's own origin, else null. */
function dialectFor(baseUrl) {
  const o = originOf(baseUrl);
  return o ? DIALECTS.find(d => d.origin() === o) || null : null;
}

function why(e, ms) {
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return `it did not answer within ${Math.round(ms / 1000)} s`;
  const code = String(e.cause?.code || e.message || '');
  if (/ECONNREFUSED/.test(code)) return 'nothing answered at its address';
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return 'its address was not found';
  return e.message && !/fetch failed/i.test(e.message) ? e.message : `it could not be reached (${e.cause?.code || 'network'})`;
}

/**
 * The provider's own figure, or why not.
 * @returns {Promise<null | { provider, label, at, ok, figure?, error? }>} null when there is no dialect for it
 */
async function of(id, { fetchImpl = fetch, timeoutMs = 8000, fresh = false, now = Date.now() } = {}) {
  let ep;
  try { ep = require('../harness/providers').endpoint(id); } catch { return null; }
  const d = dialectFor(ep.baseUrl);
  if (!d) return null;
  const hit = cache.get(id);
  if (!fresh && hit && now - hit.at < TTL_MS) return hit.value;
  const base = { provider: id, label: d.label, at: new Date(now).toISOString() };
  let value;
  if (!ep.apiKey) value = { ...base, ok: false, error: 'no key is kept for it' };
  else try {
    const r = await fetchImpl(d.origin() + d.path, { headers: { Authorization: `Bearer ${ep.apiKey}`, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) value = { ...base, ok: false, error: r.status === 401 || r.status === 403 ? `it refused the key (HTTP ${r.status})` : `it answered HTTP ${r.status}` };
    else value = { ...base, ok: true, figure: d.read(await r.json()) };
  } catch (e) { value = { ...base, ok: false, error: why(e, timeoutMs) }; }
  cache.set(id, { at: now, value });
  return value;
}

/** Every provider that has a dialect, asked together. */
async function all(opts = {}) {
  const ids = Object.keys(require('../provider-keys').all());
  const out = {};
  await Promise.all(ids.map(async id => { const v = await of(id, opts); if (v) out[id] = v; }));
  return out;
}

function mount(app) {
  app.get('/api/keys/balances', async (req, res) => {
    try { res.json({ balances: await all({ fresh: req.query.fresh === '1' }) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { of, all, dialectFor, mount, DIALECTS, _cache: cache };
