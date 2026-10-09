'use strict';

const keys = require('./provider-keys');
const { PRESETS, isLocalUrl } = require('./harness/providers');

// ─── Model Providers ──────────────────────────────────────────────────────────

/**
 * The endpoints we already know, offered as a starting point when adding one.
 *
 * Anything not in here is still addable by hand — a preset only saves you
 * typing a URL, it is not a list of what is allowed.
 */
function presetList() {
  return Object.entries(PRESETS).map(([id, p]) => ({
    id,
    label:   p.label,
    baseUrl: p.baseUrl,
    env:     p.env || null,
    local:   isLocalUrl(p.baseUrl),
  }));
}

/** GET /api/keys */
function handleGetKeys(_req, res) {
  try {
    const providers = keys.all();
    const result    = {};
    for (const [name, p] of Object.entries(providers)) {
      const key = p.apiKey || '';
      const baseUrl = p.baseUrl || PRESETS[name]?.baseUrl || '';
      // First and last four only when that leaves most of it hidden: a short
      // key masked that way was shown whole ("m-1••••••••m-1").
      const masked = key.length >= 16 ? `${key.slice(0, 4)}••••••••${key.slice(-4)}` : '••••••••';
      result[name] = {
        baseUrl,
        apiKeyMasked: key && key !== 'ollama' ? masked : key,
        hasKey: !!key && key !== 'ollama',
        // A local server needs no key, so "NO KEY" would read as broken.
        local:  isLocalUrl(baseUrl),
        models: (p.models || []).map(m => m.id || m.name || m),
        // A local model's own first-token wait and reply limit (harness/provider-pace.js), shown on its row.
        pace: require('./harness/provider-pace').sentence(require('./harness/provider-pace').of(name)) || null,
      };
    }
    res.json({ providers: result, presets: presetList() });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** Local servers speak plain /chat/completions; the hosted APIs offer /responses. */
function defaultApi(baseUrl) {
  return isLocalUrl(baseUrl) ? 'openai-chat-completions' : 'openai-responses';
}

/** POST /api/keys */
function handlePostKeys(req, res) {
  const { provider, apiKey, baseUrl } = req.body;
  if (!provider) return res.status(400).json({ error: 'provider required' });
  if (!apiKey && !baseUrl) return res.status(400).json({ error: 'apiKey or baseUrl required' });
  try {
    const had = keys.get(provider);
    const url = baseUrl || had?.baseUrl || PRESETS[provider]?.baseUrl || '';
    keys.set(provider, {
      ...(had ? {} : { api: defaultApi(url), models: [] }),
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/keys/add-provider — a local model is asked its size and given its own pace (harness/provider-pace.js). */
async function handleAddProvider(req, res) {
  const { name, apiKey, api, models: pm } = req.body;
  // A known id carries its own URL, so adding llama.cpp is just its name.
  const baseUrl = req.body.baseUrl || PRESETS[name]?.baseUrl || '';
  if (!name || !baseUrl) return res.status(400).json({ error: 'name and baseUrl required' });
  try {
    keys.set(name, { baseUrl, apiKey: apiKey || '', api: api || defaultApi(baseUrl), models: pm || [] });
    const pace = await require('./harness/provider-pace').measure(name).catch(() => null);
    res.json({ ok: true, provider: name, baseUrl, ...(pace ? { pace, paceText: require('./harness/provider-pace').sentence(pace) } : {}) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** The models an OpenAI-compatible server at `baseUrl` lists, or why not — in words, never Node's own. */
async function probe(baseUrl, apiKey = '', { timeoutMs = 8000, fetchImpl = fetch } = {}) {
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  try {
    const r = await fetchImpl(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { models: [], status: r.status, error: r.status === 401 || r.status === 403 ? 'it asks for a key' : `it answered HTTP ${r.status}` };
    const body = await r.json().catch(() => null);
    const models = (body?.data || body?.models || []).map(m => m.id || m.name).filter(Boolean);
    return models.length ? { models, error: null } : { models: [], error: 'it lists no models' };
  } catch (e) {
    const why = e.name === 'TimeoutError' || e.name === 'AbortError' ? `it did not answer within ${Math.round(timeoutMs / 1000)} s`
      : /ECONNREFUSED/.test(String(e.cause?.code || e.message)) ? 'nothing is listening there'
      : /ENOTFOUND|EAI_AGAIN/.test(String(e.cause?.code || e.message)) ? 'that name is not found'
      : `it could not be reached (${e.cause?.code || e.cause?.message || e.message})`;
    return { models: [], error: why };
  }
}

/**
 * POST /api/keys/test-provider {baseUrl, apiKey?} — does a server answer there, and with which models? Nothing is
 * saved: Set-up's "Connect and test" saved first and added a provider on every try (deep test B, C3). A server that
 * answers only under /v1 is found there too, and the address to use is returned.
 */
async function handleTestProvider(req, res) {
  const baseUrl = String(req.body?.baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(baseUrl)) return res.status(400).json({ error: 'Give its address, like http://192.168.1.20:8080/v1' });
  const apiKey = String(req.body?.apiKey || '').trim();
  let r = await probe(baseUrl, apiKey);
  let url = baseUrl;
  if (r.error && r.status === 404 && !/\/v1$/i.test(baseUrl)) {
    const v1 = await probe(`${baseUrl}/v1`, apiKey);
    if (!v1.error) { r = v1; url = `${baseUrl}/v1`; }
  }
  // The provider already kept at this address, so the panel reuses it rather than adding a copy.
  let same = null;
  try { same = Object.entries(keys.all()).find(([, p]) => String(p.baseUrl || '').replace(/\/+$/, '').toLowerCase() === url.toLowerCase()); } catch {}
  res.json({ ok: !r.error, baseUrl: url, models: r.models, error: r.error, existing: same ? same[0] : null });
}

/** DELETE /api/keys/:name */
function handleDeleteProvider(req, res) {
  try {
    if (!keys.remove(req.params.name)) return res.status(404).json({ error: 'Unknown provider' });
    require('./harness/provider-pace').forget(req.params.name);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** The provider routes beyond the plain list (server.js keeps GET/POST/DELETE /api/keys beside the others). */
function mount(app) {
  app.post('/api/keys/add-provider', handleAddProvider);
  app.post('/api/keys/test-provider', handleTestProvider);
}

module.exports = {
  mount,
  handleGetKeys,
  handlePostKeys,
  handleAddProvider,
  handleTestProvider,
  handleDeleteProvider,
  probe,
};
