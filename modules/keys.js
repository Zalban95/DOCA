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

/** POST /api/keys/add-provider */
function handleAddProvider(req, res) {
  const { name, apiKey, api, models: pm } = req.body;
  // A known id carries its own URL, so adding llama.cpp is just its name.
  const baseUrl = req.body.baseUrl || PRESETS[name]?.baseUrl || '';
  if (!name || !baseUrl) return res.status(400).json({ error: 'name and baseUrl required' });
  try {
    keys.set(name, { baseUrl, apiKey: apiKey || '', api: api || defaultApi(baseUrl), models: pm || [] });
    res.json({ ok: true, provider: name, baseUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** DELETE /api/keys/:name */
function handleDeleteProvider(req, res) {
  try {
    if (!keys.remove(req.params.name)) return res.status(404).json({ error: 'Unknown provider' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = {
  handleGetKeys,
  handlePostKeys,
  handleAddProvider,
  handleDeleteProvider,
};
