'use strict';

/**
 * What the usage ledger cost, from prices the owner typed (TODO.md, "Memory,
 * limits and context": "a usage page with prices").
 *
 * The ledger stores tokens and never money, because a stored cost is wrong the
 * day the price list moves. So the price is applied when reading, from a list
 * in prefs under `usagePrices`:
 *
 *   { currency: 'USD', models: { 'deepseek/deepseek-chat': { input, cached, output } } }
 *
 * per million tokens, keyed `provider/model` exactly as the ledger groups them.
 * **There are no default prices**: a price list shipped in code is out of date
 * on release day, and a confident wrong number is worse than "no price". A
 * model without a price costs `null`, never 0 — a free local model is a price
 * of 0 that somebody typed. `cached` falls back to `input` when it is not set,
 * which overstates rather than understates.
 */
const { loadPrefs, savePrefs } = require('../utils');

const MAX_MODELS = 200;

function load() {
  const raw = loadPrefs().usagePrices || {};
  return { currency: String(raw.currency || 'USD').slice(0, 8), models: raw.models && typeof raw.models === 'object' ? raw.models : {} };
}

const price = v => (v === '' || v == null ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : NaN);

/** Replace the list. Refuses a negative or non-numeric price rather than storing it. */
function save({ currency, models } = {}) {
  const out = {};
  for (const [key, p] of Object.entries(models || {}).slice(0, MAX_MODELS)) {
    if (!/^[^/\s]*\/\S+$/.test(key)) throw Object.assign(new Error(`"${key}" is not provider/model.`), { status: 400 });
    const row = { input: price(p?.input), cached: price(p?.cached), output: price(p?.output) };
    if (Object.values(row).some(Number.isNaN)) throw Object.assign(new Error(`${key}: a price is a number of ${currency || 'USD'} per million tokens, 0 or more.`), { status: 400 });
    if (row.input === null && row.output === null) continue;   // an emptied row is a removed row
    out[key] = row;
  }
  const prefs = loadPrefs();
  prefs.usagePrices = { currency: String(currency || 'USD').slice(0, 8), models: out };
  savePrefs(prefs);
  return load();
}

/** Cost of one ledger row ({ key: 'provider/model', prompt, completion, cached }), or null when unpriced. */
function cost(row, list = load()) {
  const p = list.models[row.key];
  if (!p || (p.input == null && p.output == null)) return null;
  const input = Number(p.input) || 0, output = Number(p.output) || 0;
  const cachedRate = p.cached == null ? input : Number(p.cached);
  const cached = Math.min(row.cached || 0, row.prompt || 0);
  return ((row.prompt - cached) * input + cached * cachedRate + row.completion * output) / 1e6;
}

/** A by-model summary with each row's cost, the priced total, and how many rows had no price. */
function price_(summary, list = load()) {
  let total = 0, unpriced = 0;
  const rows = summary.rows.map(r => {
    const c = cost(r, list);
    if (c === null) unpriced++; else total += c;
    return { ...r, cost: c };
  });
  return { ...summary, rows, currency: list.currency, cost: rows.length - unpriced ? total : null, unpriced, prices: list.models };
}

module.exports = { load, save, cost, apply: price_ };
