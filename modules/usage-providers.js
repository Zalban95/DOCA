'use strict';

/**
 * What each provider was used for, for its row in Field → API keys (asked 2026-10-16: "add the used tokens to each
 * API, and show the amount on each model"). Read from the usage ledger (harness/usage.js spans()), tokens today, this
 * month and in all (UTC, like every day here), priced with the owner's list when reading (harness/prices.js): a model
 * with no price is counted in `unpriced` calls and its money is null — never 0.
 *
 * Whose: a host reads the hive's; anyone else only their own, by spending's rule (spending/spent.js): the row's person,
 * else its conversation's owner up the chain.
 */
const SPANS = ['today', 'month', 'all'];
const FIELDS = ['calls', 'prompt', 'completion', 'cached', 'estimated'];
const blank = () => ({ calls: 0, prompt: 0, completion: 0, cached: 0, estimated: 0, money: 0, unpriced: 0 });

function addInto(into, r, cost) {
  for (const f of FIELDS) into[f] += r[f] || 0;
  if (!r.calls) return;
  if (cost === null) into.unpriced += r.calls; else into.money += cost;
}

/** Money is null when nothing in it was priced; otherwise the priced part, with `unpriced` saying how many calls had no price. */
const finish = t => ({ ...t, money: t.calls && t.unpriced === t.calls ? null : t.money });

function spanOf(r) {
  return Object.fromEntries(SPANS.map(s => [s, r[s]]));
}

/**
 * @param {{ person?: string|null, now?: Date }} opts  person null: the hive's
 * @returns {Promise<{ currency, person: boolean, providers: Record<string, { today, month, all, models: object[] }> }>}
 */
async function view({ person = null, now = new Date() } = {}) {
  const day = now.toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const month = now.toISOString().slice(0, 7) + '-01T00:00:00.000Z';
  const rows = await require('./harness/usage').spans({ day, month, perPerson: Boolean(person) });
  const prices = require('./harness/prices');
  const list = prices.load();
  const access = require('./harness/session-access');
  const owners = new Map();
  const ownerOf = s => {
    if (!s) return '';
    if (!owners.has(s)) { let o = null; try { o = access.ownerOf(s); } catch { /* removed meanwhile */ } owners.set(s, o || ''); }
    return owners.get(s);
  };
  const providers = {};
  for (const r of rows) {
    if (person && (r.person || ownerOf(r.session)) !== person) continue;
    const p = providers[r.provider] || (providers[r.provider] = { ...Object.fromEntries(SPANS.map(s => [s, blank()])), models: {} });
    const m = p.models[r.model] || (p.models[r.model] = Object.fromEntries(SPANS.map(s => [s, blank()])));
    for (const [s, t] of Object.entries(spanOf(r))) {
      const cost = prices.cost({ key: `${r.provider}/${r.model}`, ...t }, list);
      addInto(p[s], t, cost);
      addInto(m[s], t, cost);
    }
  }
  const out = {};
  for (const [id, p] of Object.entries(providers)) {
    const models = Object.entries(p.models).map(([model, m]) => ({ model, priced: Boolean(list.models[`${id}/${model}`]),
      ...Object.fromEntries(SPANS.map(s => [s, finish(m[s])])) }))
      .sort((a, b) => (b.all.prompt + b.all.completion) - (a.all.prompt + a.all.completion));
    out[id] = { ...Object.fromEntries(SPANS.map(s => [s, finish(p[s])])), models };
  }
  return { currency: list.currency, person: Boolean(person), providers: out };
}

/** A host's request reads the hive's; anyone else's (or a session capped below host) their own. */
function personFor(req) {
  if (!req.auth) return null;
  const cap = req.auth.session?.cap;
  const host = require('./auth/rights').can(req.auth.role, 'host') && (!cap || cap.includes('host'));
  return host ? null : (req.auth.user?.id || '\0nobody');
}

function mount(app) {
  app.get('/api/usage/providers', async (req, res) => {
    try { res.json(await view({ person: personFor(req) })); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { view, personFor, mount };
