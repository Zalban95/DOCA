'use strict';

/**
 * Device profiles: server-side, per device, versioned. Authored by any
 * device with `profile:*` (typically the phone), followed by the target
 * device. A profile says *what* a device shows and may do, in what order —
 * never how it looks.
 */
const store = require('./store');
const { hasScope } = require('./scopes');
const L = require('./limits');

function name(deviceId) { return `profiles/${deviceId}`; }

const DEFAULT_PROFILE = {
  version: 0,
  refreshSec: 10,
  quietHours: null,
  pages: [
    { id: 'home',  title: 'Home',  surfaces: [{ id: 'system.cpu', metrics: ['system.cpu.pct', 'system.cpu.temp'], spark: true }, { id: 'system.memory', metrics: ['system.memory.pct'] }] },
    { id: 'stack', title: 'Stack', surfaces: [{ id: 'docker.containers' }, { id: 'services.inference' }] },
  ],
  commands: [],
  prompts: { receive: true, haptic: true, allowVoice: true, allowText: true, allowImage: true },
  sensors: { allow: [], autoReport: [] },
  artifacts: [],
  ext: {},
};

function get(deviceId) {
  const p = store.readJson(name(deviceId), null);
  return p || { ...DEFAULT_PROFILE, deviceId, updatedAt: null, updatedBy: null };
}

function etagOf(profile) { return `"v${profile.version}"`; }

const clamp = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const strs = (v, max = 64, n = 128) => (Array.isArray(v) ? v : []).filter(x => typeof x === 'string').map(s => s.slice(0, max)).slice(0, n);

/** Validate and normalise an incoming profile body. Throws Error with .code on failure. */
function normalize(body) {
  if (!body || typeof body !== 'object') throw Object.assign(new Error('Profile must be an object'), { code: 'invalid_profile' });
  const out = {
    refreshSec: clamp(body.refreshSec, L.SAMPLER_MIN_INTERVAL_SEC, 3600, DEFAULT_PROFILE.refreshSec),
    quietHours: null,
    pages: [],
    commands: strs(body.commands),
    prompts: {
      receive:    body.prompts?.receive !== false,
      haptic:     body.prompts?.haptic !== false,
      allowVoice: body.prompts?.allowVoice !== false,
      allowText:  body.prompts?.allowText !== false,
      allowImage: body.prompts?.allowImage !== false,
    },
    sensors: { allow: strs(body.sensors?.allow), autoReport: strs(body.sensors?.autoReport) },
    artifacts: strs(body.artifacts),
    ext: {},
  };
  if (body.quietHours && typeof body.quietHours === 'object') {
    const hhmm = /^\d{2}:\d{2}$/;
    if (hhmm.test(body.quietHours.from) && hhmm.test(body.quietHours.to)) {
      out.quietHours = { from: body.quietHours.from, to: body.quietHours.to, allowUrgent: body.quietHours.allowUrgent !== false };
    }
  }
  const pages = Array.isArray(body.pages) ? body.pages.slice(0, 16) : [];
  for (const pg of pages) {
    if (!pg || typeof pg !== 'object' || typeof pg.id !== 'string') continue;
    const page = { id: pg.id.slice(0, 32), title: typeof pg.title === 'string' ? pg.title.slice(0, 48) : undefined, surfaces: [] };
    for (const s of (Array.isArray(pg.surfaces) ? pg.surfaces : []).slice(0, 12)) {
      const ref = typeof s === 'string' ? { id: s } : s;
      if (!ref || typeof ref.id !== 'string') continue;
      const entry = { id: ref.id.slice(0, 64) };
      if (Array.isArray(ref.metrics)) entry.metrics = strs(ref.metrics, 64, 32);
      if (ref.spark) entry.spark = true;
      if (Array.isArray(ref.commands)) entry.commands = strs(ref.commands);
      if (ref.maxItems != null) entry.maxItems = clamp(ref.maxItems, 1, 40, 10);
      page.surfaces.push(entry);
    }
    out.pages.push(page);
  }
  if (body.ext && typeof body.ext === 'object') {
    const s = JSON.stringify(body.ext);
    if (s.length > L.EXT_BYTES) throw Object.assign(new Error(`ext exceeds ${L.EXT_BYTES} bytes`), { code: 'ext_too_large' });
    out.ext = body.ext;
  }
  return out;
}

/** Persist a new version. Returns the stored profile. */
function put(deviceId, body, updatedBy) {
  const prev = get(deviceId);
  const next = { ...normalize(body), deviceId, version: (prev.version || 0) + 1, updatedAt: new Date().toISOString(), updatedBy };
  store.writeJson(name(deviceId), next);
  return next;
}

function remove(deviceId) { store.removeJson(name(deviceId)); }

/** Surface ids referenced by a profile (deduplicated, in page order). */
function surfaceIds(profile) {
  const seen = new Set();
  for (const pg of profile.pages || []) for (const s of pg.surfaces || []) seen.add(s.id);
  return [...seen];
}

/**
 * Apply the device's scopes: commands and surfaces the token does not grant
 * are removed and reported in `warnings` so the phone can see the mismatch.
 */
function effective(profile, scopes) {
  const warnings = [];
  const commands = (profile.commands || []).filter(c => {
    const ok = hasScope(scopes, `command:${c}`);
    if (!ok) warnings.push({ code: 'command_not_in_scope', id: c });
    return ok;
  });
  const pages = (profile.pages || []).map(pg => ({
    ...pg,
    surfaces: (pg.surfaces || []).filter(s => {
      const ok = hasScope(scopes, `read:${s.id}`);
      if (!ok) warnings.push({ code: 'surface_not_in_scope', id: s.id, page: pg.id });
      return ok;
    }).map(s => s.commands ? { ...s, commands: s.commands.filter(c => hasScope(scopes, `command:${c}`)) } : s),
  }));
  return { ...profile, commands, pages, warnings, etag: etagOf(profile) };
}

module.exports = { DEFAULT_PROFILE, get, put, remove, normalize, etagOf, surfaceIds, effective };
