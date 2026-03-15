'use strict';

const fs   = require('fs');
const path = require('path');

const { FM_ALLOWED_ROOTS } = require('./paths');
const { fmSafe } = require('./utils');

// ─── Directory / File Operations ──────────────────────────────────────────────

/** GET /api/files/roots */
function handleRoots(req, res) {
  res.json({ roots: FM_ALLOWED_ROOTS.filter(r => fs.existsSync(r)) });
}

/** GET /api/files/list?path=... */
function handleList(req, res) {
  const dirPath = req.query.path;
  if (!dirPath || !fmSafe(dirPath)) return res.status(403).json({ error: 'Path not allowed' });
  try {
    if (!fs.existsSync(dirPath)) return res.status(404).json({ error: 'Not found' });
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

    const names   = fs.readdirSync(dirPath);
    const entries = names.map(name => {
      try {
        const full = path.join(dirPath, name);
        const s    = fs.statSync(full);
        return {
          name,
          isDir: s.isDirectory(),
          size:  s.isDirectory() ? null : s.size,
          mtime: s.mtime.toISOString(),
          mode:  s.mode.toString(8),
        };
      } catch { return { name, isDir: false, size: null, mtime: null, mode: null }; }
    });
    res.json({ entries, path: dirPath });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** GET /api/files/read?path=... */
function handleRead(req, res) {
  const filePath = req.query.path;
  if (!filePath || !fmSafe(filePath)) return res.status(403).json({ error: 'Path not allowed' });
  try {
    const s = fs.statSync(filePath);
    if (s.isDirectory()) return res.status(400).json({ error: 'Is a directory' });
    if (s.size > 2 * 1024 * 1024) return res.status(413).json({ error: 'File too large (>2MB)' });
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content, size: s.size, mtime: s.mtime.toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/files/write  { path, content } */
function handleWrite(req, res) {
  const { path: filePath, content } = req.body;
  if (!filePath || !fmSafe(filePath)) return res.status(403).json({ error: 'Path not allowed' });
  if (content === undefined) return res.status(400).json({ error: 'No content' });
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/files/rename  { from, to } */
function handleRename(req, res) {
  const { from, to } = req.body;
  if (!from || !to || !fmSafe(from) || !fmSafe(to)) return res.status(403).json({ error: 'Path not allowed' });
  try { fs.renameSync(from, to); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/files/delete  { paths: [] } */
function handleDelete(req, res) {
  const { paths } = req.body;
  if (!Array.isArray(paths) || !paths.every(p => fmSafe(p))) return res.status(403).json({ error: 'Path not allowed' });
  const errors = [];
  paths.forEach(p => {
    try { fs.rmSync(p, { recursive: true, force: true }); }
    catch (e) { errors.push(`${p}: ${e.message}`); }
  });
  if (errors.length) return res.status(207).json({ ok: false, errors });
  res.json({ ok: true });
}

/** POST /api/files/mkdir  { path } */
function handleMkdir(req, res) {
  const { path: dirPath } = req.body;
  if (!dirPath || !fmSafe(dirPath)) return res.status(403).json({ error: 'Path not allowed' });
  try { fs.mkdirSync(dirPath, { recursive: true }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/files/paste  { op: 'copy'|'cut', paths: [], dest } */
function handlePaste(req, res) {
  const { op, paths, dest } = req.body;
  if (!dest || !fmSafe(dest) || !Array.isArray(paths)) return res.status(403).json({ error: 'Invalid request' });
  if (!paths.every(p => fmSafe(p))) return res.status(403).json({ error: 'Source path not allowed' });

  const errors = [];
  paths.forEach(src => {
    try {
      const base = path.basename(src);
      let target = path.join(dest, base);
      if (fs.existsSync(target) && src !== target) {
        const ext  = path.extname(base);
        const name = path.basename(base, ext);
        target = path.join(dest, `${name}_copy${ext}`);
      }
      if (op === 'cut') {
        fs.renameSync(src, target);
      } else {
        function cpRecurse(s, d) {
          const st = fs.statSync(s);
          if (st.isDirectory()) {
            fs.mkdirSync(d, { recursive: true });
            fs.readdirSync(s).forEach(f => cpRecurse(path.join(s, f), path.join(d, f)));
          } else {
            fs.copyFileSync(s, d);
          }
        }
        cpRecurse(src, target);
      }
    } catch (e) { errors.push(`${src}: ${e.message}`); }
  });

  if (errors.length) return res.status(207).json({ ok: false, errors });
  res.json({ ok: true });
}

// ─── Upload / Download ────────────────────────────────────────────────────────

/** POST /api/files/upload (expects multer middleware in front) */
function handleUpload(req, res) {
  const dest = req.body.dest;
  if (!dest || !fmSafe(dest)) return res.status(403).json({ error: 'Destination not allowed' });
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const results = [];
  for (const file of (req.files || [])) {
    let name = file.originalname;
    let target = path.join(dest, name);
    if (fs.existsSync(target)) {
      const ext  = path.extname(name);
      const base = path.basename(name, ext);
      name   = `${base}_${Date.now()}${ext}`;
      target = path.join(dest, name);
    }
    try {
      fs.writeFileSync(target, file.buffer);
      results.push({ name, size: file.size, ok: true });
    } catch (e) {
      results.push({ name: file.originalname, error: e.message });
    }
  }
  res.json({ results });
}

/** GET /api/files/download?path=... */
function handleDownload(req, res) {
  const filePath = req.query.path;
  if (!filePath || !fmSafe(filePath)) return res.status(403).json({ error: 'Path not allowed' });
  try {
    const s = fs.statSync(filePath);
    if (s.isDirectory()) return res.status(400).json({ error: 'Cannot download directory' });
    res.download(filePath, path.basename(filePath));
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** GET /api/files/raw?path=... — serve with correct MIME (media preview) */
function handleRaw(req, res) {
  const filePath = req.query.path;
  if (!filePath || !fmSafe(filePath)) return res.status(403).json({ error: 'Path not allowed' });
  try {
    const s = fs.statSync(filePath);
    if (s.isDirectory()) return res.status(400).json({ error: 'Cannot serve directory' });
    res.sendFile(path.resolve(filePath));
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = {
  handleRoots,
  handleList,
  handleRead,
  handleWrite,
  handleRename,
  handleDelete,
  handleMkdir,
  handlePaste,
  handleUpload,
  handleDownload,
  handleRaw,
};
