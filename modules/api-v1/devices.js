'use strict';

/**
 * Device registry: identity, hashed bearer tokens, scopes, self-declared
 * capabilities, per-device variables, and the pairing-code flow.
 *
 * Token format: `doca_<deviceId>.<secret>`. Only SHA-256(secret) is stored.
 */
const crypto = require('crypto');
const { readJson, writeJson, DATA_DIR } = require('./store');
const { normalizeAll } = require('./scopes');
const L = require('./limits');

const DOC = 'devices';

let _db = null;
let _mtime = 0;

/** mtime of the on-disk document, so tokens issued by the CLI while the server runs are picked up. */
function diskMtime() {
  try { return require('fs').statSync(require('path').join(DATA_DIR, `${DOC}.json`)).mtimeMs; } catch { return 0; }
}
function db() {
  const m = diskMtime();
  if (!_db || m !== _mtime) { _db = readJson(DOC, () => ({ devices: {} })); _mtime = m; }
  if (!_db.devices) _db.devices = {};
  return _db;
}
function persist() { writeJson(DOC, _db); _mtime = diskMtime(); }

/** Reset in-memory cache (tests). */
function _reset() { _db = null; _mtime = 0; }

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const newId  = (prefix, bytes = 6) => `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`;

// ─── Capabilities ─────────────────────────────────────────────────────────────

const FORM_FACTORS = ['watch', 'phone', 'glasses', 'tablet', 'browser', 'headless', 'other'];

/**
 * Normalise a device's self-declared capabilities. Every section is optional:
 * a device without a display simply omits `screen`; one without a camera
 * omits `input.camera`. Unknown keys are preserved under `ext`.
 */
function normalizeCaps(caps) {
  const c = caps && typeof caps === 'object' ? caps : {};
  const out = {
    formFactor: FORM_FACTORS.includes(c.formFactor) ? c.formFactor : 'other',
    protocol:   { max: typeof c.protocol?.max === 'string' ? c.protocol.max : L.PROTOCOL_VERSION },
    screen:     null,
    input:      {},
    audio:      {},
    render:     [],
    motion:     [],
    exec:       [],
    sensors:    [],
    ext:        sizeCapped(c.ext, L.EXT_BYTES) || {},
  };
  if (c.screen && typeof c.screen === 'object') {
    out.screen = {
      w:     clampInt(c.screen.w, 1, 8192, 0),
      h:     clampInt(c.screen.h, 1, 8192, 0),
      shape: c.screen.shape === 'round' ? 'round' : 'rect',
      dpr:   clampNum(c.screen.dpr, 0.5, 4, 1),
      color: c.screen.color === false ? false : true,
    };
  }
  for (const k of ['touch', 'voice', 'text', 'camera', 'buttons', 'gaze', 'crown', 'gesture']) {
    if (c.input && c.input[k]) out.input[k] = true;
  }
  for (const k of ['mic', 'speaker', 'haptic']) {
    if (c.audio && c.audio[k]) out.audio[k] = true;
  }
  const strList = (v, allowed) => (Array.isArray(v) ? v : []).map(String).filter(s => !allowed || allowed.includes(s));
  out.render = strList(c.render, ['svg', 'svg.smil', 'sprite', 'image', 'image.inline', 'text']);
  if (!out.render.includes('text')) out.render.push('text');
  out.motion = strList(c.motion, ['1']);
  out.exec   = strList(c.exec).slice(0, 16);   // open vocabulary: js, wasm, lua, shell…
  out.sensors = (Array.isArray(c.sensors) ? c.sensors : []).slice(0, 64).map(s => {
    if (typeof s === 'string') return { id: s, unit: null, maxRateHz: null };
    if (!s || typeof s !== 'object' || !s.id) return null;
    return {
      id:        String(s.id).slice(0, 48),
      unit:      s.unit ? String(s.unit).slice(0, 16) : null,
      maxRateHz: s.maxRateHz != null ? clampNum(s.maxRateHz, 0, 1000, null) : null,
      ext:       sizeCapped(s.ext, 1024) || undefined,
    };
  }).filter(Boolean);
  return out;
}

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}
function clampNum(v, min, max, dflt) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}
/** Return the object if it serialises within `max` bytes, else null. */
function sizeCapped(obj, max) {
  if (!obj || typeof obj !== 'object') return null;
  const s = JSON.stringify(obj);
  return s.length <= max ? obj : null;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

function publicView(d) {
  if (!d) return null;
  const { tokenHash, prevTokenHash, prevTokenExpiresAt, ...rest } = d;
  return rest;
}

function list() { return Object.values(db().devices).map(publicView); }
function get(id) { return db().devices[id] || null; }

/**
 * Create a device and mint its token. Returns { device, token } — the only
 * time the plaintext token is ever available.
 */
function create({ name, scopes, caps, expiresAt, kind }) {
  const id = newId('dev');
  const secret = crypto.randomBytes(32).toString('base64url');
  const rec = {
    id,
    name:       String(name || id).slice(0, 64),
    kind:       kind || 'device',
    scopes:     normalizeAll(scopes),
    caps:       normalizeCaps(caps),
    vars:       {},
    varsVersion: 0,
    tokenHash:  sha256(secret),
    createdAt:  new Date().toISOString(),
    lastSeenAt: null,
    expiresAt:  expiresAt || null,
    revokedAt:  null,
  };
  db().devices[id] = rec;
  persist();
  return { device: publicView(rec), token: `doca_${id}.${secret}` };
}

/** Resolve a bearer token to a live device record, or null. */
function authenticate(token) {
  const m = /^doca_(dev_[0-9a-f]+)\.([A-Za-z0-9_-]+)$/.exec(String(token || ''));
  if (!m) return null;
  const rec = db().devices[m[1]];
  if (!rec || rec.revokedAt) return null;
  if (rec.expiresAt && Date.parse(rec.expiresAt) < Date.now()) return null;
  const h = sha256(m[2]);
  const ok = h === rec.tokenHash
    || (rec.prevTokenHash === h && rec.prevTokenExpiresAt && Date.parse(rec.prevTokenExpiresAt) > Date.now());
  if (!ok) return null;
  rec.lastSeenAt = new Date().toISOString();
  return rec;
}

let _lastTouch = 0;
/** Persist best-effort `lastSeenAt` updates at most every 30 s. */
function touchPersist() {
  if (Date.now() - _lastTouch < 30000) return;
  _lastTouch = Date.now();
  db(); persist();
}

function rotate(id) {
  const rec = db().devices[id];
  if (!rec) return null;
  const secret = crypto.randomBytes(32).toString('base64url');
  rec.prevTokenHash = rec.tokenHash;
  rec.prevTokenExpiresAt = new Date(Date.now() + L.TOKEN_ROTATE_GRACE_SEC * 1000).toISOString();
  rec.tokenHash = sha256(secret);
  persist();
  return { device: publicView(rec), token: `doca_${id}.${secret}`, previousValidUntil: rec.prevTokenExpiresAt };
}

function revoke(id) {
  const rec = db().devices[id];
  if (!rec) return false;
  rec.revokedAt = new Date().toISOString();
  rec.tokenHash = 'revoked';
  delete rec.prevTokenHash;
  persist();
  return true;
}

function remove(id) {
  const existed = !!db().devices[id];
  delete db().devices[id];
  persist();
  return existed;
}

function update(id, patch) {
  const rec = db().devices[id];
  if (!rec) return null;
  if (patch.name !== undefined)   rec.name = String(patch.name).slice(0, 64);
  if (patch.scopes !== undefined) rec.scopes = normalizeAll(patch.scopes);
  if (patch.caps !== undefined)   rec.caps = normalizeCaps({ ...rec.caps, ...patch.caps, ext: { ...(rec.caps.ext || {}), ...(patch.caps.ext || {}) } });
  if (patch.expiresAt !== undefined) rec.expiresAt = patch.expiresAt || null;
  persist();
  return publicView(rec);
}

/** Merge into the device's variables document (null deletes a key). */
function patchVars(id, patch) {
  const rec = db().devices[id];
  if (!rec) return null;
  const next = { ...(rec.vars || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null) delete next[k]; else next[k] = v;
  }
  if (JSON.stringify(next).length > L.VARS_BYTES) return { error: 'vars_too_large' };
  rec.vars = next;
  rec.varsVersion = (rec.varsVersion || 0) + 1;
  rec.varsUpdatedAt = new Date().toISOString();
  persist();
  return { vars: rec.vars, version: rec.varsVersion, updatedAt: rec.varsUpdatedAt };
}

// ─── Pairing codes (in-memory, short-lived) ───────────────────────────────────

const _pairings = new Map();

function startPairing({ name, scopes, expiresAt, kind, createdBy }) {
  for (const [code, p] of _pairings) if (p.expiresAt < Date.now()) _pairings.delete(code);
  let code;
  do { code = String(crypto.randomInt(0, 1e6)).padStart(6, '0'); } while (_pairings.has(code));
  const rec = { code, name, scopes: normalizeAll(scopes), tokenExpiresAt: expiresAt || null, kind, createdBy,
                expiresAt: Date.now() + L.PAIR_CODE_TTL_SEC * 1000 };
  _pairings.set(code, rec);
  return { code: `${code.slice(0, 3)}-${code.slice(3)}`, expiresAt: new Date(rec.expiresAt).toISOString(), scopes: rec.scopes, name };
}

function completePairing(codeInput, caps, nameOverride) {
  const code = String(codeInput || '').replace(/\D/g, '');
  const p = _pairings.get(code);
  if (!p || p.expiresAt < Date.now()) { _pairings.delete(code); return null; }
  _pairings.delete(code);
  return create({ name: nameOverride || p.name, scopes: p.scopes, caps, expiresAt: p.tokenExpiresAt, kind: p.kind });
}

module.exports = {
  FORM_FACTORS, normalizeCaps, publicView,
  list, get, create, authenticate, rotate, revoke, remove, update, patchVars, touchPersist,
  startPairing, completePairing, _reset,
};
