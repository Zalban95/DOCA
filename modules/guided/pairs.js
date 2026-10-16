'use strict';

/**
 * A mastermind and a worker, offered per budget (owner, 2026-10-16; turn/model-route.js). The candidates are data — the
 * `pairs` table of suggested-models.json, versioned, with its source and the day it was checked — and an offer is made
 * only from providers whose key is already here: Set-up never asks for a key in a chat, and sends a missing one to
 * Field → API keys. Nothing is chosen without a click: `check` only verifies, against the provider's own /models list,
 * that the two models exist there now, and answers the two values the panel then saves through POST /api/prefs.
 */
const ROLES = ['mastermind', 'worker'];

/** The providers as the panel knows them, by id ({id, label, hasKey}). */
function known(list) {
  if (!list) { try { list = require('../harness/providers').list(); } catch { list = []; } }
  return Object.fromEntries(list.map(p => [p.id, p]));
}

const value = e => `${e.provider}/${e.model}`;

/**
 * Each budget with, per role, the first candidate whose provider has a key (or null), and the providers a key would
 * open when a role has none. `current`: what is set now.
 */
function offer(doc, providers = null) {
  const t = doc?.pairs;
  if (!t || !Array.isArray(t.budgets)) return null;
  const byId = known(providers);
  const keyed = e => !!byId[e.provider]?.hasKey;
  const current = {};
  for (const r of ROLES) { try { current[r] = require('../settings-schema').value(`harness.models.${r}`) || ''; } catch { current[r] = ''; } }
  const budgets = t.budgets.map(b => {
    const pick = Object.fromEntries(ROLES.map(r => [r, (b[r] || []).find(keyed) || null]));
    const missing = [...new Set(ROLES.filter(r => !pick[r]).flatMap(r => (b[r] || []).map(e => e.provider)))]
      .map(id => ({ id, label: byId[id]?.label || id, keyPage: doc.keyPages?.[id] || null }));
    return { id: b.id, label: b.label, what: b.what, ...pick, ready: ROLES.every(r => pick[r]), missing,
      chosen: ROLES.every(r => pick[r] && current[r] === value(pick[r])) };
  });
  return { version: t.version, checked: t.checked, source: t.source, about: t.about, current, budgets };
}

/**
 * Whether a budget's pair can be used now: each model must be in its provider's own /models list. Answers the two
 * settings' values, or refuses (409) naming what the provider offers instead. `models(id)` is providers.models.
 */
async function check(doc, budgetId, { providers = null, models = id => require('../harness/providers').models(id) } = {}) {
  const o = offer(doc, providers);
  const b = o?.budgets.find(x => x.id === budgetId);
  if (!b) throw Object.assign(new Error(`No budget "${budgetId}" in the suggested pairs: ${(o?.budgets || []).map(x => x.id).join(', ') || 'none'}.`), { status: 400 });
  if (!b.ready) throw Object.assign(new Error(`${b.label} needs a key for ${b.missing.map(m => m.label).join(' or ')} — paste it in Field → API keys, never in a chat.`), { status: 409, code: 'no_key' });
  const out = {};
  for (const r of ROLES) {
    const e = b[r], got = await models(e.provider);
    if (!got.models.includes(e.model)) {
      const near = got.models.filter(m => m.split('/')[0] === e.model.split('/')[0]).slice(0, 40);
      throw Object.assign(new Error(`${e.name} (${e.model}) is not in ${e.provider}'s model list${got.error ? ` (${got.error})` : ''} — nothing was set. `
        + (near.length ? `It offers from the same maker: ${near.join(', ')}.` : `It offers ${got.models.length} models.`)), { status: 409, code: 'not_offered', available: got.models });
    }
    out[r] = value(e);
  }
  return { budget: b.id, values: out, settings: Object.fromEntries(ROLES.map(r => [`harness.models.${r}`, out[r]])) };
}

module.exports = { offer, check, ROLES };
