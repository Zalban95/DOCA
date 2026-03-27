'use strict';

const fs = require('fs');

const { CONFIG_PATH } = require('./paths');

// ─── Model Providers ──────────────────────────────────────────────────────────

/** GET /api/keys */
function handleGetKeys(req, res) {
  try {
    const cfg       = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const providers = cfg?.models?.providers || {};
    const result    = {};
    for (const [name, p] of Object.entries(providers)) {
      const key = p.apiKey || '';
      result[name] = {
        baseUrl:      p.baseUrl || '',
        apiKeyMasked: key && key !== 'ollama'
          ? key.slice(0, 4) + '••••••••' + key.slice(-4)
          : key,
        hasKey: !!key && key !== 'ollama',
        models: (p.models || []).map(m => m.id || m.name || m),
      };
    }
    res.json({ providers: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/keys */
function handlePostKeys(req, res) {
  const { provider, apiKey, baseUrl } = req.body;
  if (!provider) return res.status(400).json({ error: 'provider required' });
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!cfg.models) cfg.models = {};
    if (!cfg.models.providers) cfg.models.providers = {};
    if (!cfg.models.providers[provider])
      cfg.models.providers[provider] = { api: 'openai-responses', models: [] };
    if (apiKey)  cfg.models.providers[provider].apiKey  = apiKey;
    if (baseUrl) cfg.models.providers[provider].baseUrl = baseUrl;
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/keys/add-provider */
function handleAddProvider(req, res) {
  const { name, baseUrl, apiKey, api, models: pm } = req.body;
  if (!name || !baseUrl) return res.status(400).json({ error: 'name and baseUrl required' });
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!cfg.models) cfg.models = {};
    if (!cfg.models.providers) cfg.models.providers = {};
    cfg.models.providers[name] = { baseUrl, apiKey: apiKey || '', api: api || 'openai-responses', models: pm || [] };
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** DELETE /api/keys/:name */
function handleDeleteProvider(req, res) {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (cfg?.models?.providers?.[req.params.name])
      delete cfg.models.providers[req.params.name];
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = {
  handleGetKeys,
  handlePostKeys,
  handleAddProvider,
  handleDeleteProvider,
};
