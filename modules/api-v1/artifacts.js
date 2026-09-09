'use strict';

/**
 * Agent-authored artifacts: small executable or data payloads (a JS snippet,
 * a wasm module, a Lua script, a JSON table…) that the agent wants a device
 * to run or use. The server stores and delivers them; it never executes
 * them. Delivery is gated on the target device declaring the artifact's
 * runtime in `caps.exec`, so a device that cannot run it never receives it.
 */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const store  = require('./store');
const bus    = require('./bus');
const L      = require('./limits');

let _index = null;
function index() { if (!_index) _index = store.readJson('artifacts', {}); return _index; }
function persist() { store.writeJson('artifacts', index()); }

/**
 * @param {object} spec  { name, runtime, mime, content (utf8 string) | contentBase64, entry, params, purpose, targets, ttlSec, ext }
 */
function create(spec, createdBy) {
  if (!spec || typeof spec !== 'object') throw Object.assign(new Error('artifact body required'), { code: 'invalid_artifact', status: 400 });
  const runtime = String(spec.runtime || '').slice(0, 32);
  if (!runtime) throw Object.assign(new Error('runtime is required (e.g. js, wasm, lua, json)'), { code: 'invalid_artifact', status: 400 });
  let buf;
  if (typeof spec.contentBase64 === 'string') buf = Buffer.from(spec.contentBase64, 'base64');
  else if (typeof spec.content === 'string') buf = Buffer.from(spec.content, 'utf8');
  else throw Object.assign(new Error('content or contentBase64 is required'), { code: 'invalid_artifact', status: 400 });
  if (buf.length > L.ARTIFACT_BYTES) throw Object.assign(new Error(`artifact exceeds ${L.ARTIFACT_BYTES} bytes`), { code: 'payload_too_large', status: 413 });

  const id = `art_${crypto.randomBytes(8).toString('hex')}`;
  const file = path.join(store.dir('artifacts'), id);
  fs.writeFileSync(file, buf, { mode: 0o600 });
  const rec = {
    id, name: String(spec.name || id).slice(0, 64), runtime,
    mime: String(spec.mime || (runtime === 'js' ? 'text/javascript' : 'application/octet-stream')).slice(0, 64),
    bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    entry:   typeof spec.entry === 'string' ? spec.entry.slice(0, 128) : null,
    params:  spec.params && typeof spec.params === 'object' && JSON.stringify(spec.params).length <= L.EXT_BYTES ? spec.params : {},
    purpose: typeof spec.purpose === 'string' ? spec.purpose.slice(0, 280) : null,
    targets: Array.isArray(spec.targets) ? spec.targets.map(String).slice(0, 64) : null,   // null = any device with artifacts scope
    ext:     spec.ext && typeof spec.ext === 'object' && JSON.stringify(spec.ext).length <= L.EXT_BYTES ? spec.ext : {},
    createdBy, createdAt: new Date().toISOString(),
    expiresAt: spec.ttlSec ? new Date(Date.now() + Math.min(30 * 86400, Number(spec.ttlSec) || 0) * 1000).toISOString() : null,
    file,
  };
  index()[id] = rec;
  persist();
  return publicView(rec);
}

function publicView(rec) {
  if (!rec) return null;
  const { file, ...rest } = rec;
  return { ...rest, url: `/api/v1/artifacts/${rec.id}`, contentUrl: `/api/v1/artifacts/${rec.id}/content` };
}

function get(id) {
  const rec = index()[id];
  if (!rec) return null;
  if (rec.expiresAt && Date.parse(rec.expiresAt) < Date.now()) { remove(id); return null; }
  return rec;
}

function readBuffer(id) {
  const rec = get(id);
  if (!rec) return null;
  try { return fs.readFileSync(rec.file); } catch { return null; }
}

function remove(id) {
  const rec = index()[id];
  if (!rec) return false;
  try { fs.rmSync(rec.file, { force: true }); } catch {}
  delete index()[id];
  persist();
  return true;
}

function list() { return Object.values(index()).map(publicView); }

/** May `device` fetch this artifact? */
function visibleTo(rec, device, hasWildcard) {
  if (hasWildcard) return true;
  if (!rec.targets) return true;
  return rec.targets.includes(device.id);
}

/**
 * Push an `artifact.deliver` event to target devices whose caps.exec
 * includes the runtime. Returns a per-device delivery report.
 */
function deliver(rec, targets, opts = {}) {
  const report = [];
  for (const d of targets) {
    if (d.revokedAt) continue;
    const exec = d.caps?.exec || [];
    if (!exec.includes(rec.runtime)) { report.push({ deviceId: d.id, delivered: false, reason: 'runtime_unsupported', exec }); continue; }
    const env = bus.publish(d.id, 'artifact.deliver', {
      artifact: publicView(rec), inline: opts.inline ? readBuffer(rec.id).toString(rec.mime.startsWith('text/') || rec.runtime === 'js' || rec.runtime === 'json' ? 'utf8' : 'base64') : undefined,
      inlineEncoding: opts.inline ? (rec.mime.startsWith('text/') || rec.runtime === 'js' || rec.runtime === 'json' ? 'utf8' : 'base64') : undefined,
      message: opts.message || null, ext: opts.ext || undefined,
    });
    report.push({ deviceId: d.id, delivered: true, seq: env.seq });
  }
  return report;
}

function _reset() { _index = null; }

module.exports = { create, get, readBuffer, remove, list, visibleTo, deliver, publicView, _reset };
