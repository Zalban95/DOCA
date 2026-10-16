'use strict';

/**
 * OpenRouter's own figure for a key (https://openrouter.ai/docs — GET /api/v1/key): credits used by this key, its
 * limit and what remains of it, in US dollars. `DOCA_OPENROUTER_ORIGIN` points it at a stub in the tests.
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
};
