'use strict';

/**
 * What is wrong with the providers kept in Field → API keys → External providers, said on their rows with a one-click
 * fix (asked 2026-10-10, from what the agent found on a live hub):
 *
 *   - the same provider twice at one address ("Mistral" with the key, "mistral" without): merged into the one holding
 *     the key — the other's models joined in, every `provider` the settings name pointed at it, the old name kept as an
 *     alias (provider-keys.resolve), so nothing that chose it stops working. Two different keys at one address are two
 *     accounts and are left alone, as provider-dedupe.js leaves them;
 *   - an OpenAI-compatible server kept without its /v1: asked at the address and at /v1, and the fix offered only when
 *     /v1 is the one that answers.
 *
 * Nothing changes until the person clicks: GET /api/keys/checks reads, POST /api/keys/merge merges.
 */
const dedupe = require('./provider-dedupe');

const keyOf = p => (p?.apiKey && p.apiKey !== 'ollama' ? p.apiKey : '');
/** An address that already says its version, or is one of the vendors' own compatible paths. */
const VERSIONED = /\/(v\d+(beta\d*|alpha\d*)?|openai|compatible-mode\/v\d+|api\/v\d+)(\/|$)/i;

/** Pure: groups at one address that can be merged — `[{ address, keep, drop: [..] }]`. */
function duplicates(providers) {
  const groups = new Map();
  for (const [id, p] of Object.entries(providers || {})) {
    const a = dedupe.norm(p?.baseUrl);
    if (!a || id === 'ollama') continue;
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a).push(id);
  }
  const out = [];
  for (const [address, ids] of groups) {
    if (ids.length < 2) continue;
    const keyed = ids.filter(id => keyOf(providers[id]));
    if (new Set(keyed.map(id => keyOf(providers[id]))).size > 1) continue;   // two accounts, not a copy
    const keep = keyed[0] || ids.find(id => id === id.toLowerCase()) || ids[0];
    out.push({ address: providers[keep].baseUrl, keep, drop: ids.filter(x => x !== keep) });
  }
  return out;
}

/** Merge `drop` into `keep` (they must be at one address, with at most one key between them). */
function merge(keep, drop, { keys = require('./provider-keys'), utils = require('./utils') } = {}) {
  const all = keys.all();
  const bad = msg => Object.assign(new Error(msg), { status: 400 });
  if (!all[keep]) throw bad(`No provider "${keep}".`);
  drop = [...new Set((Array.isArray(drop) ? drop : [drop]).map(String))].filter(x => x !== keep);
  if (!drop.length) throw bad('Name the providers to merge into it.');
  const group = duplicates(all).find(g => g.keep === keep || g.drop.includes(keep));
  const wrong = drop.filter(x => !group || ![group.keep, ...group.drop].includes(x));
  if (wrong.length) throw bad(`${wrong.join(', ')} ${wrong.length === 1 ? 'is' : 'are'} not the same provider as ${keep} (another address, or another key).`);
  const seen = new Set(), models = [];
  for (const id of [keep, ...drop]) for (const m of all[id].models || []) { const k = typeof m === 'string' ? m : m?.id || m?.name; if (k && !seen.has(k)) { seen.add(k); models.push(m); } }
  const key = keyOf(all[keep]) || drop.map(id => keyOf(all[id])).find(Boolean) || '';
  keys.set(keep, { models, ...(key ? { apiKey: key } : {}) });
  const into = {};
  for (const id of drop) { keys.remove(id); keys.alias(id, keep); into[id] = keep; try { require('./harness/provider-pace').forget(id); } catch { /* no pace kept */ } }
  const prefs = utils.loadPrefs();
  const repointed = dedupe.repoint(prefs, into);
  if (repointed) utils.savePrefs(prefs);
  return { kept: keep, merged: drop, repointed, models: models.length };
}

/** Providers whose address has no version in it: asked at the address and at /v1 — `[{ name, baseUrl, fix|null, said }]`. */
async function versions(providers, { probe = require('./keys').probe } = {}) {
  const cands = Object.entries(providers || {}).filter(([id, p]) => id !== 'ollama' && /^https?:\/\//i.test(p?.baseUrl || '') && !VERSIONED.test(new URL(p.baseUrl).pathname));
  return Promise.all(cands.map(async ([name, p]) => {
    const base = String(p.baseUrl).replace(/\/+$/, ''), key = keyOf(p);
    const here = await probe(base, key, { timeoutMs: 4000 });
    if (!here.error) return null;   // it answers as it is
    const v1 = await probe(`${base}/v1`, key, { timeoutMs: 4000 });
    return v1.error
      ? { name, baseUrl: p.baseUrl, fix: null, said: `No /v1 in its address, and neither ${base}/models (${here.error}) nor ${base}/v1/models (${v1.error}) answers.` }
      : { name, baseUrl: p.baseUrl, fix: `${base}/v1`, said: `${base}/models ${here.error}; ${base}/v1/models lists ${v1.models.length} model${v1.models.length === 1 ? '' : 's'} — OpenAI-compatible servers answer under /v1.` };
  })).then(r => r.filter(Boolean));
}

async function checks(opts) {
  const all = require('./provider-keys').all();
  return { duplicates: duplicates(all), versions: await versions(all, opts) };
}

function mount(app) {
  const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/api/keys/checks', h(() => checks()));
  app.post('/api/keys/merge', h(req => merge(String(req.body?.keep || ''), req.body?.drop || [])));
}

module.exports = { duplicates, merge, versions, checks, mount, VERSIONED };
