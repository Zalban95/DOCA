'use strict';

/**
 * GET /api/v1/harness/usage — what the agents have spent, so a watch can show it at a glance. Read-only and tokens only
 * (usage.js keeps no money). Two readings, neither of them the ledger:
 * - by provider (the default, as before): the hive's calls and tokens per provider since `days` ago;
 * - `by=model` (2026-10-09, for the watch's ring of models): this device's person's own calls and tokens per
 *   `provider/model`, each row given to the person whose conversation it is exactly as spending does
 *   (spending/spent.js: the row's person, else its conversation's owner up the chain). A device paired before accounts
 *   (no person) reads the hive's, as by provider. No conversation, session or day is named.
 * Its own file because router.js is past the size the structure test allows to grow.
 */
const { requireScope } = require('./auth');

/** One person's calls and tokens per provider/model since `days` ago (rolling, like summary()). */
async function byModel({ days = 1, person = null, now = new Date() } = {}) {
  const usage = require('../harness/usage');
  const n = Math.min(Math.max(Number(days) || 1, 1), 366);
  const since = new Date(now.getTime() - n * 86400000).toISOString();
  const rows = await usage.byConversation({ since, until: new Date(now.getTime() + 1000).toISOString() });
  const access = require('../harness/session-access');
  const owners = new Map();
  const ownerOf = s => {
    if (!s) return '';
    if (!owners.has(s)) { let o = null; try { o = access.ownerOf(s); } catch { /* a conversation since removed */ } owners.set(s, o || ''); }
    return owners.get(s);
  };
  const blank = () => ({ calls: 0, prompt: 0, completion: 0, cached: 0, estimated: 0 });
  const total = blank(), by = new Map();
  for (const r of rows) {
    if (person && (r.person || ownerOf(r.session)) !== person) continue;
    const row = by.get(r.key) || by.set(r.key, { key: r.key, ...blank() }).get(r.key);
    for (const k of Object.keys(total)) { row[k] += r[k] || 0; total[k] += r[k] || 0; }
  }
  const out = [...by.values()].sort((a, b) => (b.prompt + b.completion) - (a.prompt + a.completion));
  return { since, by: 'model', person: Boolean(person), total, rows: out };
}

function mount(router) {
  router.get('/harness/usage', requireScope('harness:chat'), async (req, res) => {
    try {
      if (req.query.by === 'model') return res.json(await byModel({ days: req.query.days || 1, person: req.device?.userId || null }));
      res.json(await require('../harness/usage').summary({ days: req.query.days || 1, by: 'provider' }));
    }
    catch (e) { res.status(e.status || 500).json({ error: { code: e.status === 400 ? 'bad_request' : 'internal', message: e.message } }); }
  });
}

function openapi({ obj, str, int, arr, bool, json, std }) {
  const totals = { calls: int(), prompt: int(), completion: int(), cached: int(), estimated: int({ description: 'Calls whose numbers the provider did not report.' }) };
  return {
    '/harness/usage': { get: { tags: ['Harness'], summary: 'Model calls and tokens per provider, or this person\'s per model, for a glance', operationId: 'harnessUsage', 'x-scope': 'harness:chat',
      parameters: [{ name: 'days', in: 'query', schema: int({ description: 'Default 1, maximum 366.' }) },
        { name: 'by', in: 'query', schema: str({ enum: ['provider', 'model'], description: '`provider` (default): the hive\'s, per provider. `model`: this device\'s person\'s own, per `provider/model` (the hive\'s for a device with no person).' }) }],
      responses: { 200: json(obj({ since: str({ format: 'date-time' }), by: str(), person: bool({ description: 'With by=model: whether the rows are this device\'s person\'s alone.' }), total: obj(totals),
        rows: arr(obj({ key: str({ description: 'Provider id, or provider/model with by=model.' }), ...totals })) })), ...std(401, 403) } } },
  };
}

module.exports = { mount, openapi, byModel };
