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
/**
 * A revoked device is announced (`events`, 'revoked'), so what it was given goes with it: the MCP servers it hosts
 * (devices-revoked.js). By any route — the panel, /api/v1, or `npm run token -- revoke` from another process, which this
 * process sees when it next reads the file, so newly revoked ids are announced from the reload too.
 */
const events = new (require('events'))();
const announce = id => setImmediate(() => events.emit('revoked', id));

function db() {
  const m = diskMtime();
  if (!_db || m !== _mtime) {
    const before = _db ? new Set(Object.values(_db.devices || {}).filter(d => d.revokedAt).map(d => d.id)) : null;
    _db = readJson(DOC, () => ({ devices: {} })); _mtime = m;
    if (before) for (const d of Object.values(_db.devices || {})) if (d.revokedAt && !before.has(d.id)) announce(d.id);
  }
  if (!_db.devices) _db.devices = {};
  return _db;
}
function persist() { writeJson(DOC, _db); _mtime = diskMtime(); }

/** Reset in-memory cache (tests). */
function _reset() { _db = null; _mtime = 0; }

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const newId  = (prefix, bytes = 6) => `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`;

// ─── Capabilities ─────────────────────────────────────────────────────────────

const FORM_FACTORS = ['watch', 'phone', 'car', 'glasses', 'tablet', 'desktop', 'browser', 'headless', 'other'];

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
  const { tokenHash, prevTokenHash, prevTokenExpiresAt, refusedHash, ...rest } = d;
  return rest;
}

function list() { return Object.values(db().devices).map(publicView); }
function get(id) { return db().devices[id] || null; }

/**
 * Create a device and mint its token. Returns { device, token } — the only
 * time the plaintext token is ever available.
 */
/**
 * A device's name: what it sent, trimmed, unless that is empty or the text of
 * a missing value — a client that sends `String(null)` got a device called
 * "null" in every list (audit 2026-09-26, §4f). Then its id.
 */
function cleanName(name, id) {
  const n = String(name ?? '').trim();
  return (!n || /^(null|undefined|nan)$/i.test(n) ? id : n).slice(0, 64);
}

/**
 * Every kind of device record (PROTOCOL §5): a paired client, an agent acting on devices, a signed-in browser
 * (screens/), a linked chat (channels/). openapi.js reads this list, so the document cannot fall behind it.
 */
const KINDS = ['device', 'agent', 'browser', 'channel'];

/**
 * A device waiting for a person to approve it (devices-approval/; the owner's decision of 2026-10-09): it reads its own
 * record and holds its event stream, and nothing else (pending.js). A record with no `approval` was made before
 * approval existed, or by the host itself, and is approved.
 */
const isPending = d => d?.approval?.state === 'pending';

function create({ name, scopes, caps, expiresAt, kind, approval }) {
  require('../license/limits').checkDevice(kind || 'device');   // a production hive's licence devices (license/limits.js)
  const id = newId('dev');
  const secret = crypto.randomBytes(32).toString('base64url');
  const rec = {
    id,
    name:       cleanName(name, id),
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
    ...(approval ? { approval } : {}),
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

/**
 * Who refused a device that waited for approval, for its own token only: a watch that polls (or a phone that was
 * away) missed `device.refused`, which goes with the queue the refusal drops, and saw a bare 401 with no name.
 */
function refusedOf(token) {
  const m = /^doca_(dev_[0-9a-f]+)\.([A-Za-z0-9_-]+)$/.exec(String(token || ''));
  const rec = m && db().devices[m[1]];
  if (!rec || !rec.revokedAt || rec.approval?.state !== 'refused' || !rec.refusedHash || sha256(m[2]) !== rec.refusedHash) return null;
  return { by: rec.approval.by?.name || rec.approval.byName || null, at: rec.approval.at || rec.revokedAt };
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
  // A refused device keeps its token's hash (never usable again) only so its own token can learn who said no.
  if (rec.approval?.state === 'refused' && rec.tokenHash !== 'revoked') rec.refusedHash = rec.tokenHash;
  rec.tokenHash = 'revoked';
  delete rec.prevTokenHash;
  persist();
  announce(id);
  return true;
}

function remove(id) {
  const existed = !!db().devices[id];
  delete db().devices[id];
  persist();
  return existed;
}

/**
 * Revoke *and* forget: the row goes, and so does everything keyed to the id.
 *
 * Revoking deliberately keeps the row — it is the audit trail, and a device
 * whose token stopped working should be visible as such. But nothing was ever
 * removing them, so the panel accumulated `REVOKED` rows for every re-pair and
 * every test, with no way to clear one. This is the other half of that pair.
 *
 * The cleanup lives here rather than in a route because the two HTTP surfaces
 * (`/api/v1` and the panel) were already doing different amounts of it: the
 * panel's `?purge=1` dropped the row and left the outbox file and the profile
 * behind, orphaned under an id nothing could ever authenticate as again.
 * `require`s are inline because the registry is loaded by almost everything and
 * these two are not needed to read it.
 */
function forget(id) {
  if (!db().devices[id]) return false;
  revoke(id);
  try { require('./bus').dropDevice(id, 'forgotten'); } catch {}
  try { require('./profiles').remove(id); } catch {}
  return remove(id);
}

function update(id, patch) {
  const rec = db().devices[id];
  if (!rec) return null;
  if (patch.name !== undefined)   rec.name = cleanName(patch.name, rec.name || id);
  if (patch.scopes !== undefined) rec.scopes = normalizeAll(patch.scopes);
  if (patch.caps !== undefined)   rec.caps = normalizeCaps({ ...rec.caps, ...patch.caps, ext: { ...(rec.caps.ext || {}), ...(patch.caps.ext || {}) } });
  if (patch.expiresAt !== undefined) rec.expiresAt = patch.expiresAt || null;
  // Whose device it is (docs/design/auth.md): set when accounts arrive, and at pairing.
  if (patch.userId !== undefined) rec.userId = patch.userId || null;
  if (patch.orgId !== undefined)  rec.orgId = patch.orgId || null;
  // The phone that minted this device's pairing code: where a wake goes (wake.js).
  if (patch.pairedBy !== undefined) rec.pairedBy = patch.pairedBy || null;
  // Approved or refused (devices-approval/): only that module writes it.
  if (patch.approval !== undefined) rec.approval = patch.approval;
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

/**
 * `approval`: decided when the pairing starts — { state: 'approved', … } when whoever started it may approve the
 * device (devices-approval/ `atStart`), else null and the device that completes it waits for a person.
 */
function startPairing({ name, scopes, expiresAt, kind, createdBy, userId = null, orgId = null, approval = null }) {
  require('../license/limits').checkDevice(kind || 'device');   // no code is minted past the licence's devices
  for (const [code, p] of _pairings) if (p.expiresAt < Date.now()) _pairings.delete(code);
  let code;
  do { code = String(crypto.randomInt(0, 1e6)).padStart(6, '0'); } while (_pairings.has(code));
  const rec = { code, name, scopes: normalizeAll(scopes), tokenExpiresAt: expiresAt || null, kind, createdBy, userId, orgId, approval,
                expiresAt: Date.now() + L.PAIR_CODE_TTL_SEC * 1000 };
  _pairings.set(code, rec);
  return { code: `${code.slice(0, 3)}-${code.slice(3)}`, expiresAt: new Date(rec.expiresAt).toISOString(), scopes: rec.scopes, name };
}

/** `from`: where the device paired from ({ address, network }), shown to whoever is asked to approve it. */
function completePairing(codeInput, caps, nameOverride, from = null) {
  const code = String(codeInput || '').replace(/\D/g, '');
  const p = _pairings.get(code);
  if (!p || p.expiresAt < Date.now()) { _pairings.delete(code); return null; }
  _pairings.delete(code);
  const at = new Date().toISOString();
  // Decided at the start: the scopes it carries are already held to the approver and the person (owner-ceiling.js).
  const { scopes: capped, ...decided } = p.approval || {};
  const approval = p.approval ? { ...decided, at, from } : { state: 'pending', askedAt: at, from };
  const made = create({ name: nameOverride || p.name, scopes: capped || p.scopes, caps, expiresAt: p.tokenExpiresAt, kind: p.kind, approval });
  if (p.userId) made.device = update(made.device.id, { userId: p.userId, orgId: p.orgId });
  if (p.createdBy) made.device = update(made.device.id, { pairedBy: p.createdBy });
  return made;
}

/**
 * Devices paired before approval existed are approved as they are (migration 2.344-devices-approved): a device that
 * worked yesterday is never asked about. Returns how many were marked.
 */
function markApproved(at = new Date().toISOString()) {
  let n = 0;
  for (const rec of Object.values(db().devices)) if (!rec.approval) { rec.approval = { state: 'approved', by: null, via: 'migration', at }; n++; }
  if (n) persist();
  return n;
}

/** Names stored before cleanName existed ("null"): the device's form factor and id instead. Once, at boot. */
function repairNames() {
  const d = db();
  let n = 0;
  for (const rec of Object.values(d.devices)) {
    if (cleanName(rec.name, rec.id) === rec.id && rec.name !== rec.id) {
      rec.name = `${rec.caps?.formFactor || 'device'} ${rec.id.slice(-4)}`;
      n++;
    }
  }
  if (n) persist();
  return n;
}

module.exports = { refusedOf, KINDS, repairNames, cleanName, isPending, markApproved,
  FORM_FACTORS, normalizeCaps, publicView,
  list, get, create, authenticate, rotate, revoke, remove, forget, update, patchVars, touchPersist, events,
  startPairing, completePairing, _reset,
};
