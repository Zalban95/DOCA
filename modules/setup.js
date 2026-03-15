'use strict';

const fs   = require('fs');
const path = require('path');

const { SETUP_DIR, ALLOWED_SCRIPTS } = require('./paths');

/** GET /api/setup/scripts */
function handleList(req, res) {
  const scripts = ALLOWED_SCRIPTS.map(name => {
    const fullPath = path.join(SETUP_DIR, name);
    const exists   = fs.existsSync(fullPath);
    let size = 0, modified = null;
    if (exists) { const s = fs.statSync(fullPath); size = s.size; modified = s.mtime.toISOString(); }
    return { name, exists, size, modified };
  });
  res.json({ scripts });
}

/** GET /api/setup/scripts/:name */
function handleGet(req, res) {
  if (!ALLOWED_SCRIPTS.includes(req.params.name)) return res.status(403).json({ error: 'Not allowed' });
  const fp = path.join(SETUP_DIR, req.params.name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  res.json({ content: fs.readFileSync(fp, 'utf8') });
}

/** POST /api/setup/scripts/:name */
function handlePost(req, res) {
  if (!ALLOWED_SCRIPTS.includes(req.params.name)) return res.status(403).json({ error: 'Not allowed' });
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'No content' });
  const fp = path.join(SETUP_DIR, req.params.name);
  try {
    if (fs.existsSync(fp)) fs.copyFileSync(fp, fp + '.bak');
    fs.writeFileSync(fp, content, 'utf8');
    fs.chmodSync(fp, 0o755);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { handleList, handleGet, handlePost };
