'use strict';

/**
 * Which files the Library reads (docs/experiments/library.md): the folders the owner chose, each one only if it is
 * inside the Files tab's roots and not protected (`fmSafe` — the same rule the file manager and the agent's file
 * tools follow, so the Library never reaches a file they could not), walked without following links, skipping
 * hidden folders, build output, virtual environments and DOCA's own data. A file is one of four kinds by its
 * extension; anything else is not the Library's.
 */
const fs = require('fs');
const path = require('path');

const KINDS = {
  documents: ['.txt', '.md', '.markdown', '.rst', '.org', '.csv', '.tsv', '.json', '.yaml', '.yml', '.toml', '.ini', '.log', '.html', '.htm', '.xml',
    '.js', '.ts', '.py', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.cs', '.rb', '.php', '.sh', '.ps1', '.sql', '.tex',
    '.pdf', '.doc', '.docx', '.odt', '.rtf', '.ppt', '.pptx', '.odp', '.xls', '.xlsx', '.ods', '.epub'],
  images: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.avif'],
  audio: ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.wma', '.aiff', '.aif', '.webm'],
  video: ['.mp4', '.m4v', '.mov', '.mkv', '.avi', '.wmv', '.mpg', '.mpeg', '.3gp', '.ogv'],
};
const BY_EXT = new Map(Object.entries(KINDS).flatMap(([k, list]) => list.map(e => [e, k])));
// .webm is audio by default here; one with a picture in it is read as video when ffprobe says so (extract.js).
const kindOf = name => BY_EXT.get(path.extname(String(name)).toLowerCase()) || null;

const SKIP = new Set(['node_modules', '__pycache__', '.git', '.hg', '.svn', 'venv', '.venv', 'env', 'dist', 'build', 'target', '.cache', '.Trash', '.trash']);

/** A chosen folder the Library may read, resolved; null when it is not inside the Files roots or is protected. */
function allowedFolder(dir) {
  if (!dir || typeof dir !== 'string' || !path.isAbsolute(dir)) return null;
  const abs = path.resolve(dir);
  const { fmSafe } = require('../utils');
  if (!fmSafe(abs)) return null;
  try { if (!fs.statSync(abs).isDirectory()) return null; } catch { return null; }
  return abs;
}

/** DOCA's own data folder is never indexed, wherever it sits. */
const dataDir = () => path.resolve(require('../store').DATA_DIR);

/**
 * Every file of `folders` of the chosen kinds: [{path, folder, kind, size, mtimeMs}], at most `max` (the rest
 * counted in `over`). Synchronous on purpose but bounded: it reads directories, never file contents.
 */
function walk(folders, { kinds = Object.keys(KINDS), max = 20000 } = {}) {
  const want = new Set(kinds);
  const files = [], skipped = { folders: [] };
  let over = 0;
  const data = dataDir();
  const { fmSafe } = require('../utils');
  for (const f of folders) {
    const root = allowedFolder(f);
    if (!root) { skipped.folders.push(f); continue; }
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isSymbolicLink()) continue;   // a link may lead outside the folder: never followed
        if (e.isDirectory()) {
          if (SKIP.has(e.name) || full === data || !fmSafe(full)) continue;
          stack.push(full);
          continue;
        }
        if (!e.isFile()) continue;
        const kind = kindOf(e.name);
        if (!kind || !want.has(kind)) continue;
        if (files.length >= max) { over++; continue; }
        let st;
        try { st = fs.statSync(full); } catch { continue; }
        files.push({ path: full, folder: root, kind, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
      }
    }
  }
  return { files, over, skipped };
}

module.exports = { KINDS, kindOf, walk, allowedFolder };
