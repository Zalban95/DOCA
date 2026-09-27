'use strict';

/**
 * GET /api/v1/harness/usage — what the agents have spent, per provider, so a
 * watch can show it at a glance. Read-only and tokens only (usage.js keeps no
 * money); grouped by provider and nothing finer, so `harness:chat` does not
 * become a way to read the ledger. Its own file because router.js is past the
 * size the structure test allows to grow.
 */
const { requireScope } = require('./auth');

function mount(router) {
  router.get('/harness/usage', requireScope('harness:chat'), async (req, res) => {
    try { res.json(await require('../harness/usage').summary({ days: req.query.days || 1, by: 'provider' })); }
    catch (e) { res.status(e.status || 500).json({ error: { code: e.status === 400 ? 'bad_request' : 'internal', message: e.message } }); }
  });
}

function openapi({ obj, str, int, arr, json, std }) {
  const totals = { calls: int(), prompt: int(), completion: int(), cached: int(), estimated: int({ description: 'Calls whose numbers the provider did not report.' }) };
  return {
    '/harness/usage': { get: { tags: ['Harness'], summary: 'Model calls and tokens per provider, for a glance', operationId: 'harnessUsage', 'x-scope': 'harness:chat',
      parameters: [{ name: 'days', in: 'query', schema: int({ description: 'Default 1, maximum 366.' }) }],
      responses: { 200: json(obj({ since: str({ format: 'date-time' }), by: str(), total: obj(totals), rows: arr(obj({ key: str({ description: 'Provider id.' }), ...totals })) })), ...std(401, 403) } } },
  };
}

module.exports = { mount, openapi };
