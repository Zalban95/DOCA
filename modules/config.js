'use strict';

const fs = require('fs');

const paths = require('./paths');
const {
  HOME, COMPOSE_DIR, CONFIG_PATH, SKILLS_DIR, WORKSPACE_DIR,
  SNAPSHOT_DIR, CONFIG_REGISTRY,
} = paths;
const { loadPrefs, savePrefs, writeFileSafe } = require('./utils');

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
    writeFileSafe(filePath, content);
    res.json({ ok: true, backup: filePath + '.bak' });
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
    savePrefs({ ...loadPrefs(), ...req.body });
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
    savePrefs(prefs);
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
    savePrefs(prefs);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ─── Server Paths (for frontend portability) ─────────────────────────────────

/** GET /api/paths */
function handleGetPaths(_req, res) {
  res.json({
    home:           HOME,
    composeDir:     COMPOSE_DIR,
    configPath:     CONFIG_PATH,
    skillsDir:      SKILLS_DIR,
    workspaceDir:   WORKSPACE_DIR,
    snapshotDir:    SNAPSHOT_DIR,
    configRegistry: CONFIG_REGISTRY,
    settable:       paths.describe(),
  });
}

/** POST /api/paths — body { COMPOSE_DIR: '…', … }. An empty value clears the
 *  override and hands the path back to the environment or the default. */
function handlePostPaths(req, res) {
  const keys = paths.SETTABLE.map(p => p.key);
  const unknown = Object.keys(req.body || {}).filter(k => !keys.includes(k));
  if (unknown.length) return res.status(400).json({ error: `Not a settable path: ${unknown.join(', ')}` });

  try {
    const prefs = loadPrefs();
    const saved = { ...prefs.paths };
    for (const [key, value] of Object.entries(req.body)) {
      const trimmed = String(value ?? '').trim();
      if (trimmed) saved[key] = trimmed;
      else delete saved[key];
    }
    prefs.paths = saved;
    savePrefs(prefs);
    // The constants above were read at boot, so the change lands on restart.
    res.json({ ok: true, restartRequired: true, settable: paths.describe() });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/paths/create — body { key }. Makes a path that is not there yet. */
function handleCreatePath(req, res) {
  try {
    res.json({ ok: true, ...paths.create(req.body?.key), settable: paths.describe() });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}

module.exports = {
  handleGetConfig,
  handlePostConfig,
  handleGetPrefs,
  handlePostPrefs,
  handleGetConfigFavorites,
  handlePostConfigFavorites,
  handleGetFmFavorites,
  handlePostFmFavorites,
  handleGetPaths,
  handlePostPaths,
  handleCreatePath,
};
