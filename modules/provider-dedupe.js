'use strict';

/**
 * One provider per address. Set-up's "Connect and test" saved before it tested, and every try added a provider —
 * deep test B left four for one server and the sidebar listed the same model three times (C3). The panel now tests
 * first and reuses a provider at the same address (settings/guided-plan.js); this is the clean-up for installs that
 * already have the copies, run once as migration 2.329-providers-merged.
 *
 * Only providers with no key are merged: a key makes two entries different accounts at one address, which a person
 * may well want. The one kept is the one the settings name most (the agent's own model first), else the first; the
 * others' model lists are joined into it, every `provider` the settings name is pointed at it, and each removed name
 * is kept as an alias (provider-keys.resolve) so a conversation that chose a model under the old name still finds it.
 */
const norm = u => String(u || '').trim().replace(/\/+$/, '').toLowerCase();
const keyless = p => !p?.apiKey || p.apiKey === 'ollama';
const modelId = m => (typeof m === 'string' ? m : m?.id || m?.name);

/** Every `provider: <id>` in the settings, counted (the agent's own model counts double: it is the one in use). */
function references(prefs) {
  const n = {};
  const walk = (o, at) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'provider' && typeof v === 'string') n[v] = (n[v] || 0) + (at === 'harness.config.doca' ? 2 : 1);
      else walk(v, at ? `${at}.${k}` : k);
    }
  };
  walk(prefs, '');
  return n;
}

/** Pure: which providers fold into which — `{ [removed]: kept }` — and the joined model lists. */
function plan(providers, prefs = {}) {
  const refs = references(prefs);
  const groups = new Map();
  for (const [id, p] of Object.entries(providers || {})) {
    if (!keyless(p) || !norm(p.baseUrl) || id === 'ollama') continue;
    const k = norm(p.baseUrl);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(id);
  }
  const into = {}, models = {};
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const keep = [...ids].sort((a, b) => (refs[b] || 0) - (refs[a] || 0) || ids.indexOf(a) - ids.indexOf(b))[0];
    const seen = new Set(), joined = [];
    for (const id of [keep, ...ids.filter(x => x !== keep)]) {
      for (const m of providers[id].models || []) { const mid = modelId(m); if (mid && !seen.has(mid)) { seen.add(mid); joined.push(m); } }
      if (id !== keep) into[id] = keep;
    }
    models[keep] = joined;
  }
  return { into, models };
}

/** Point every `provider` in the settings named in `into` at the one kept. Returns how many changed. */
function repoint(prefs, into) {
  let changed = 0;
  const walk = o => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'provider' && typeof v === 'string' && into[v]) { o[k] = into[v]; changed++; } else walk(v);
    }
  };
  walk(prefs);
  return changed;
}

/** The migration's step: merge in the keys file, repoint the settings. True when anything changed. */
function merge(prefs, keys = require('./provider-keys')) {
  const { into, models } = plan(keys.all(), prefs);
  if (!Object.keys(into).length) return false;
  for (const [keep, list] of Object.entries(models)) keys.set(keep, { models: list });
  for (const [gone, keep] of Object.entries(into)) { keys.remove(gone); keys.alias(gone, keep); }
  repoint(prefs, into);
  return true;
}

module.exports = { plan, repoint, merge, references, norm };
