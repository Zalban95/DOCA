'use strict';

/**
 * Files attached to a conversation.
 *
 * They are kept as *files*, and what reaches the model is a path — not the
 * bytes, and not a new modality. A path costs about twenty tokens whether it
 * names a 2 KB CSV or a 40 MB STEP file; `read_file`, `list_dir` and `shell`
 * already make the agent useful on one; and "put that one in <somewhere>" is a
 * tool call rather than a feature. Vision, once there is a model with it,
 * becomes one optional thing done *to* a file that already exists instead of
 * the precondition for attaching anything at all.
 *
 * This is not `modules/api-v1/media.js` and must not grow into it. That store is
 * deliberately the opposite in every respect — it expires, it is mode 0600, it
 * is addressed by a `med_` id, and it lives outside the workspace. A device
 * uploading a photo still goes through it, and the harness adapter then copies
 * the bytes here, because a reference the agent is forbidden to read is not a
 * reference at all (charter rule 8 keeps it to the panel's allowed roots, and
 * ATTACHMENTS_DIR is inside them by default).
 *
 * The directory is the index. Anything sitting in it is an attachment, a file
 * somebody dropped there from a file manager included — that is behaviour to
 * keep, not an accident to close off. The JSON sidecar adds only what the
 * filesystem cannot say (which device sent it, what it was called before the
 * name was made safe), and a file with no entry is listed just the same.
 */
const fs   = require('fs');
const path = require('path');

const paths = require('./paths');
const store = require('./store');

/**
 * One attachment, matching the app-wide multer limit in server.js.
 *
 * The cap is on the *upload*, not on what the agent can work with: the escape
 * hatch is the directory itself. Drop a 4 GB archive in it by hand and say its
 * name — the agent reads it by path like any other, which is the whole point of
 * attachments being files rather than a modality.
 */
const MAX_BYTES = 50 * 1024 * 1024;

/** Enough to be useful in a listing; the agent opens the file for the rest. */
const MIME = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values',
  '.json': 'application/json', '.xml': 'application/xml', '.yml': 'text/yaml', '.yaml': 'text/yaml',
  '.log': 'text/plain', '.ini': 'text/plain', '.cfg': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.7z': 'application/x-7z-compressed',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.mkv': 'video/x-matroska',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * The pictures a chat draws inline: what every current browser renders in an
 * `<img>`. BMP renders too, but nothing produces one on purpose any more;
 * converting it is one command and keeps this list short.
 */
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml']);

function mimeFor(name) {
  return MIME[path.extname(String(name)).toLowerCase()] || 'application/octet-stream';
}

/**
 * The directory, resolved now.
 *
 * Not the boot constant: a path saved in Settings since boot is exactly the case
 * the user is told needs a restart, and anything acting on a path has to ask
 * again rather than trust what it captured at require time.
 */
function dir() {
  const row = paths.describe().find(p => p.key === 'ATTACHMENTS_DIR');
  return (row && row.value) || paths.ATTACHMENTS_DIR;
}

function ensureDir() {
  const d = dir();
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/* ── Naming ───────────────────────────────────────────── */

/**
 * A filename that cannot leave the directory or surprise a shell.
 *
 * Separators, control characters and the leading dots that hide a file are
 * removed rather than replaced with something clever: the original is kept in
 * the sidecar, so nothing is lost by being blunt here.
 */
function safeName(raw) {
  const base = path.basename(String(raw || 'file')).normalize('NFC');
  const cleaned = [...base]
    .filter(ch => { const c = ch.codePointAt(0); return c > 31 && c !== 127; })
    .join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  const name = cleaned || 'file';
  if (name.length <= 120) return name;
  const ext = path.extname(name).slice(0, 12);
  return name.slice(0, 120 - ext.length) + ext;
}

/** `report.pdf`, then `report-2.pdf`. Never silently overwrite somebody's file. */
function uniqueName(d, wanted) {
  const ext  = path.extname(wanted);
  const stem = wanted.slice(0, wanted.length - ext.length);
  let name = wanted;
  for (let n = 2; fs.existsSync(path.join(d, name)); n++) name = `${stem}-${n}${ext}`;
  return name;
}

/* ── The sidecar ──────────────────────────────────────── */

function index()      { return store.readJson('attachments', {}); }
function saveIndex(i) { store.writeJson('attachments', i); }

/* ── Writing ──────────────────────────────────────────── */

/**
 * Put bytes in the directory and describe what landed.
 * @returns {{ name: string, path: string, bytes: number, mime: string }}
 */
function save(buffer, filename, meta = {}) {
  if (!Buffer.isBuffer(buffer)) throw Object.assign(new Error('attachment must be a buffer'), { status: 400 });
  if (buffer.length > MAX_BYTES)
    throw Object.assign(new Error(
      `That is over the ${Math.round(MAX_BYTES / 1e6)} MB upload limit. Put the file in `
      + `${dir()} yourself and say its name — the agent reads it the same way.`), { status: 413 });

  const d    = ensureDir();
  const name = uniqueName(d, safeName(filename));
  const abs  = path.join(d, name);
  fs.writeFileSync(abs, buffer);

  const i = index();
  i[name] = {
    originalName: String(filename || name),
    from: meta.from || null,
    at:   new Date().toISOString(),
    mime: meta.mime || mimeFor(name),
  };
  try { saveIndex(i); } catch { /* the file is the point; the sidecar is extra */ }

  return { name, path: abs, bytes: buffer.length, mime: i[name].mime };
}

/* ── Reading ──────────────────────────────────────────── */

/** One attachment by name, or null. A name can never leave the directory. */
function get(name) {
  const safe = safeName(name);
  const abs  = path.join(dir(), safe);
  let st;
  try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isFile()) return null;
  const meta = index()[safe] || {};
  return {
    name: safe, path: abs, bytes: st.size,
    mime: meta.mime || mimeFor(safe),
    at:   meta.at   || st.mtime.toISOString(),
    from: meta.from || null,
    originalName: meta.originalName || safe,
  };
}

/** Everything in the directory, newest first — files nobody registered included. */
function list({ limit = 100 } = {}) {
  let names;
  try { names = fs.readdirSync(dir()); } catch { return []; }
  return names
    .map(get)
    .filter(Boolean)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, limit);
}

/** What a caller named, as records. Names that are not there are dropped. */
function resolve(names) {
  return (Array.isArray(names) ? names : [names])
    .filter(Boolean)
    .map(get)
    .filter(Boolean)
    .map(({ name, path: p, bytes, mime }) => ({ name, path: p, bytes, mime }));
}

function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1e6)  return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1e9)  return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

/**
 * What the model is told, appended to the message the attachments came with.
 *
 * A path, a size, and one sentence saying these are files on this machine —
 * because the useful next move is `read_file` or `shell`, and a model that has
 * only ever been handed image bytes elsewhere will not guess that on its own.
 */
function note(records) {
  if (!records || !records.length) return '';
  const lines = records.map(a => `- ${a.path} (${humanBytes(a.bytes)}, ${a.mime})`);
  return '\n\n[Attached to this message — real files on this machine, not images you can see. '
    + 'Open them with read_file, list_dir or shell, and copy one elsewhere with shell if asked.]\n'
    + lines.join('\n');
}

/* ── Routes ───────────────────────────────────────────── */

/** GET /api/attachments */
function handleList(req, res) {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  res.json({ dir: dir(), attachments: list({ limit }) });
}

/**
 * Send one attachment's bytes, for a chat drawing a picture the agent showed.
 *
 * The headers are the part that matters. `nosniff` so a file is only ever the
 * type its extension says; and a sandboxing CSP because an SVG is a document
 * that can carry script — inert inside `<img>`, live if somebody opens the
 * picture in its own tab. `imagesOnly` is for callers that must not become a
 * way to read every file in the directory.
 */
function sendFile(res, name, { imagesOnly = false } = {}) {
  const rec = get(name);
  if (!rec || (imagesOnly && !IMAGE_MIME.has(rec.mime))) return false;
  res.setHeader('Content-Type', rec.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Content-Disposition', `inline; filename="${rec.name.replace(/"/g, '')}"`);
  res.sendFile(rec.path);
  return true;
}

/** GET /api/attachments/:name */
function handleRaw(req, res) {
  if (!sendFile(res, req.params.name)) res.status(404).json({ error: 'No such attachment' });
}

/** POST /api/attachments — multipart, field `file`. */
function handleUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  try {
    res.json(save(req.file.buffer, req.file.originalname, { from: 'panel', mime: req.file.mimetype }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

module.exports = {
  MAX_BYTES, MIME, IMAGE_MIME,
  dir, ensureDir, safeName, uniqueName, mimeFor, humanBytes,
  save, get, list, resolve, note,
  sendFile, handleList, handleRaw, handleUpload,
};
