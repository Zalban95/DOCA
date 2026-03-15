'use strict';

const fs   = require('fs');
const path = require('path');

const { CONFIG_PATH, CONFIG_REGISTRY, PREFS_FILE } = require('./paths');
const { loadPrefs } = require('./utils');

// ─── Multi-file config ────────────────────────────────────────────────────────

/** GET /api/configs/:id */
function handleGetConfig(req, res) {
  const filePath = CONFIG_REGISTRY[req.params.id];
  if (!filePath) return res.status(404).json({ error: 'Unknown config id' });
  try {
    const content = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf8')
      : '';
    res.json({ content, path: filePath });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/configs/:id */
function handlePostConfig(req, res) {
  const filePath = CONFIG_REGISTRY[req.params.id];
  if (!filePath) return res.status(404).json({ error: 'Unknown config id' });
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'No content' });
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, filePath + '.bak');
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ ok: true, backup: filePath + '.bak' });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** GET /api/config (legacy) */
function handleGetLegacyConfig(req, res) {
  try { res.json({ config: fs.readFileSync(CONFIG_PATH, 'utf8') }); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/config (legacy) */
function handlePostLegacyConfig(req, res) {
  const { config } = req.body;
  if (!config) return res.status(400).json({ error: 'No config provided' });
  try {
    JSON.parse(config);
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
    fs.writeFileSync(CONFIG_PATH, config, 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ─── Prefs ────────────────────────────────────────────────────────────────────

/** GET /api/prefs */
function handleGetPrefs(req, res) {
  res.json(loadPrefs());
}

/** POST /api/prefs */
function handlePostPrefs(req, res) {
  try {
    const prefs = loadPrefs();
    const updated = { ...prefs, ...req.body };
    fs.writeFileSync(PREFS_FILE, JSON.stringify(updated, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ─── Config Favorites ─────────────────────────────────────────────────────────

/** GET /api/config-favorites */
function handleGetConfigFavorites(req, res) {
  const prefs = loadPrefs();
  res.json({ favorites: prefs.favorites || [], hiddenBuiltins: prefs.hiddenBuiltins || [] });
}

/** POST /api/config-favorites */
function handlePostConfigFavorites(req, res) {
  const { favorites, hiddenBuiltins } = req.body;
  if (!Array.isArray(favorites)) return res.status(400).json({ error: 'favorites must be array' });
  const prefs = loadPrefs();
  prefs.favorites = favorites;
  if (Array.isArray(hiddenBuiltins)) prefs.hiddenBuiltins = hiddenBuiltins;
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ─── File Manager Favorites ───────────────────────────────────────────────────

/** GET /api/fm-favorites */
function handleGetFmFavorites(req, res) {
  const prefs = loadPrefs();
  res.json({ favorites: prefs.fmFavorites || [] });
}

/** POST /api/fm-favorites */
function handlePostFmFavorites(req, res) {
  const { favorites } = req.body;
  if (!Array.isArray(favorites)) return res.status(400).json({ error: 'favorites must be array' });
  const prefs = loadPrefs();
  prefs.fmFavorites = favorites;
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = {
  handleGetConfig,
  handlePostConfig,
  handleGetLegacyConfig,
  handlePostLegacyConfig,
  handleGetPrefs,
  handlePostPrefs,
  handleGetConfigFavorites,
  handlePostConfigFavorites,
  handleGetFmFavorites,
  handlePostFmFavorites,
};
