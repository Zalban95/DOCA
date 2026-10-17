'use strict';

/**
 * OpenRouter's own figure for a key (https://openrouter.ai/docs — GET /api/v1/key): credits used by this key, its
 * limit and what remains of it, in US dollars — and the account's own credit (GET /api/v1/credits: bought minus used),
 * which is what a request is refused for: a key's $100 limit read as "93 left" while the account held under a dollar,
 * and every Opus request came back HTTP 402 (2026-10-17). `DOCA_OPENROUTER_ORIGIN` points it at a stub in the tests.
 */
const origin = () => (process.env.DOCA_OPENROUTER_ORIGIN || 'https://openrouter.ai').replace(/\/+$/, '');

module.exports = {
  id: 'openrouter',
  label: 'OpenRouter',
  origin,
  path: '/api/v1/key',
  /** @returns {{ currency, used, limit, remaining, note }} */
  read(body) {
    const d = body?.data;
    if (!d || typeof d !== 'object') throw new Error('it answered without the key\'s figures');
    const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    return { currency: 'USD', used: num(d.usage), limit: num(d.limit), remaining: num(d.limit_remaining),
      note: d.is_free_tier ? 'free tier' : null };
  },
  /** The account's credit, read beside the key's figure: { credit } — what is left to spend, all keys together. */
  also: {
    path: '/api/v1/credits',
    read(body) {
      const d = body?.data, total = Number(d?.total_credits), used = Number(d?.total_usage);
      return Number.isFinite(total) && Number.isFinite(used) ? { credit: Math.round((total - used) * 1e6) / 1e6, creditBought: total } : {};
    },
  },
};
