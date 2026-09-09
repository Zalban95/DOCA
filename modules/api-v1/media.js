'use strict';

/**
 * Device-uploaded media (photos from a camera, audio clips) and the
 * server-side registry for them. Files live under .doca/media and expire
 * after MEDIA_TTL_HOURS. A media id is a reference that can be used in a
 * selection payload, a message, or read back by the agent.
 */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const store  = require('./store');
const L      = require('./limits');

const ALLOWED = {
  'image/jpeg': { ext: 'jpg',  kind: 'image' },
  'image/png':  { ext: 'png',  kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'audio/ogg':  { ext: 'ogg',  kind: 'audio' },
  'audio/webm': { ext: 'webm', kind: 'audio' },
  'audio/mp4':  { ext: 'm4a',  kind: 'audio' },
  'audio/mpeg': { ext: 'mp3',  kind: 'audio' },
  'audio/wav':  { ext: 'wav',  kind: 'audio' },
  'audio/x-wav':{ ext: 'wav',  kind: 'audio' },
  'audio/flac': { ext: 'flac', kind: 'audio' },
  'application/octet-stream': { ext: 'bin', kind: 'other' },
  'application/json': { ext: 'json', kind: 'other' },
  'text/plain': { ext: 'txt', kind: 'other' },
};

let _index = null;
function index() { if (!_index) _index = store.readJson('media', {}); return _index; }
function persist() { store.writeJson('media', index()); }

function normalizeMime(m) { return String(m || 'application/octet-stream').split(';')[0].trim().toLowerCase(); }

function save(buffer, mimeRaw, ownerDeviceId, meta = {}) {
  const mime = normalizeMime(mimeRaw);
  const spec = ALLOWED[mime];
  if (!spec) throw Object.assign(new Error(`Unsupported media type ${mime}`), { code: 'unsupported_media', status: 415 });
  const max = spec.kind === 'audio' ? L.AUDIO_BYTES : L.MEDIA_BYTES;
  if (buffer.length > max) throw Object.assign(new Error(`Media exceeds ${max} bytes`), { code: 'payload_too_large', status: 413 });
  const id = `med_${crypto.randomBytes(8).toString('hex')}`;
  const file = path.join(store.dir('media'), `${id}.${spec.ext}`);
  fs.writeFileSync(file, buffer, { mode: 0o600 });
  const rec = {
    id, mime, kind: spec.kind, bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    ownerDeviceId, file,
    meta: pickMeta(meta),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + L.MEDIA_TTL_HOURS * 3600 * 1000).toISOString(),
  };
  index()[id] = rec;
  persist();
  return publicView(rec);
}

function pickMeta(m) {
  const out = {};
  for (const k of ['w', 'h', 'durationMs', 'capturedAt', 'source', 'label']) if (m[k] != null) out[k] = m[k];
  if (m.ext && typeof m.ext === 'object' && JSON.stringify(m.ext).length <= L.EXT_BYTES) out.ext = m.ext;
  return out;
}

function publicView(rec) {
  if (!rec) return null;
  const { file, ...rest } = rec;
  return { ...rest, url: `/api/v1/media/${rec.id}` };
}

function get(id) {
  const rec = index()[id];
  if (!rec) return null;
  if (Date.parse(rec.expiresAt) < Date.now()) { remove(id); return null; }
  return rec;
}

function readBuffer(id) {
  const rec = get(id);
  if (!rec) return null;
  try { return fs.readFileSync(rec.file); } catch { return null; }
}

function remove(id) {
  const rec = index()[id];
  if (!rec) return;
  try { fs.rmSync(rec.file, { force: true }); } catch {}
  delete index()[id];
  persist();
}

function purgeExpired() {
  const now = Date.now();
  for (const [id, rec] of Object.entries(index())) if (Date.parse(rec.expiresAt) < now) remove(id);
}

function _reset() { _index = null; }

module.exports = { ALLOWED, save, get, readBuffer, remove, purgeExpired, publicView, normalizeMime, _reset };
