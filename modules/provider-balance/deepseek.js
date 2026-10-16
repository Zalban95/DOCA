'use strict';

/**
 * DeepSeek's own balance for the account (https://api-docs.deepseek.com — GET /user/balance): what is left, topped up
 * and granted, per currency. `DOCA_DEEPSEEK_ORIGIN` points it at a stub in the tests.
 */
const origin = () => (process.env.DOCA_DEEPSEEK_ORIGIN || 'https://api.deepseek.com').replace(/\/+$/, '');

module.exports = {
  id: 'deepseek',
  label: 'DeepSeek',
  origin,
  path: '/user/balance',
  /** @returns {{ currency, balance, toppedUp, granted, note }} — the first currency listed, the others in `others` */
  read(body) {
    const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : null;
    if (!infos) throw new Error('it answered without a balance');
    const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
    const rows = infos.map(b => ({ currency: String(b.currency || '').slice(0, 8), balance: num(b.total_balance),
      toppedUp: num(b.topped_up_balance), granted: num(b.granted_balance) }));
    const [first, ...others] = rows;
    return { ...(first || { currency: null, balance: null }), others,
      note: body.is_available === false ? 'not enough balance to make calls' : null };
  },
};
