'use strict';

/**
 * On-demand device sensors.
 *
 * Devices declare what they have in caps.sensors (open vocabulary —
 * `accelerometer`, `gyroscope`, `magnetometer`, `heading`, `location`,
 * `barometer`, `ambientLight`, `heartRate`, `steps`, `battery`,
 * `orientation`, `proximity`, `temperature`, or anything else). Nothing is
 * collected until the agent asks: a sensor request is pushed to the device
 * with a rate and a duration; the device streams batched samples back; the
 * server forwards them to the requester and keeps a short ring for reads.
 * The device profile (`sensors.allow`) is the consent list.
 */
const crypto = require('crypto');
const bus = require('./bus');
const L   = require('./limits');

const _requests = new Map();          // requestId → request
const _rings    = new Map();          // deviceId → [{ sensor, ts, value, values, ext, requestId }]

const clamp = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };

function allowed(profile, sensorId) {
  const list = profile?.sensors?.allow || [];
  return list.includes('*') || list.includes(sensorId);
}
function autoReport(profile, sensorId) {
  const list = profile?.sensors?.autoReport || [];
  return list.includes('*') || list.includes(sensorId);
}

/**
 * Validate a request against the target device and profile. Returns
 * { request, rejected: [{ id, reason }] } — rejected sensors are dropped,
 * not fatal, unless none remain.
 */
function createRequest({ device, profile, sensors, reason, requestedBy, ext }) {
  const declared = new Map((device.caps?.sensors || []).map(s => [s.id, s]));
  const accepted = [], rejected = [];
  for (const raw of (Array.isArray(sensors) ? sensors : []).slice(0, 16)) {
    const s = typeof raw === 'string' ? { id: raw } : raw;
    if (!s || typeof s.id !== 'string') continue;
    if (!declared.has(s.id))          { rejected.push({ id: s.id, reason: 'not_declared' }); continue; }
    if (!allowed(profile, s.id))      { rejected.push({ id: s.id, reason: 'not_allowed_by_profile' }); continue; }
    const maxRate = declared.get(s.id).maxRateHz || L.SENSOR_MAX_RATE_HZ;
    accepted.push({
      id: s.id,
      mode: s.mode === 'once' ? 'once' : 'stream',
      rateHz: clamp(s.rateHz, 0.01, Math.min(maxRate, L.SENSOR_MAX_RATE_HZ), 1),
      durationSec: clamp(s.durationSec, 1, L.SENSOR_MAX_DURATION_SEC, 30),
      unit: declared.get(s.id).unit || null,
    });
  }
  if (!accepted.length) return { request: null, rejected };
  const durationSec = Math.max(...accepted.map(a => a.durationSec));
  const req = {
    id: `sreq_${crypto.randomBytes(6).toString('hex')}`,
    deviceId: device.id, requestedBy, sensors: accepted,
    reason: typeof reason === 'string' ? reason.slice(0, 200) : null,
    ext: ext && typeof ext === 'object' && JSON.stringify(ext).length <= L.EXT_BYTES ? ext : undefined,
    status: 'active', createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + (durationSec + 30) * 1000).toISOString(),
    sampleCount: 0, lastSampleAt: null,
  };
  _requests.set(req.id, req);
  bus.publish(device.id, 'sensor.request', { request: req }, { ttlSec: durationSec + 30 });
  return { request: req, rejected };
}

function getRequest(id) {
  const r = _requests.get(id);
  if (!r) return null;
  if (r.status === 'active' && Date.parse(r.expiresAt) < Date.now()) r.status = 'expired';
  return r;
}

function stopRequest(id, reason) {
  const r = _requests.get(id);
  if (!r) return null;
  if (r.status === 'active') {
    r.status = 'stopped';
    bus.publish(r.deviceId, 'sensor.stop', { requestId: r.id, reason: reason || 'stopped' });
  }
  return r;
}

/**
 * Ingest a batch of samples from a device. Returns { accepted, rejected }.
 * Samples are forwarded (ephemeral) to the requesting agent device.
 */
function ingest(device, profile, body) {
  const samples = Array.isArray(body?.samples) ? body.samples.slice(0, L.SENSOR_BATCH_MAX) : [];
  const requestId = typeof body?.requestId === 'string' ? body.requestId : null;
  const req = requestId ? getRequest(requestId) : null;
  if (requestId && (!req || req.deviceId !== device.id)) return { error: 'unknown_request' };
  const declared = new Set((device.caps?.sensors || []).map(s => s.id));
  const ring = _rings.get(device.id) || [];
  const accepted = [], rejected = [];
  const now = new Date().toISOString();
  for (const s of samples) {
    if (!s || typeof s.sensor !== 'string') { rejected.push({ reason: 'malformed' }); continue; }
    if (!declared.has(s.sensor)) { rejected.push({ sensor: s.sensor, reason: 'not_declared' }); continue; }
    const inRequest = req && req.status === 'active' && req.sensors.some(x => x.id === s.sensor);
    if (!inRequest && !autoReport(profile, s.sensor)) { rejected.push({ sensor: s.sensor, reason: 'not_requested' }); continue; }
    const rec = {
      sensor: s.sensor, ts: typeof s.ts === 'string' ? s.ts : now,
      value:  typeof s.value === 'number' ? s.value : undefined,
      values: Array.isArray(s.values) ? s.values.slice(0, 16).map(Number) : undefined,
      accuracy: s.accuracy != null ? s.accuracy : undefined,
      ext: s.ext && typeof s.ext === 'object' && JSON.stringify(s.ext).length <= 1024 ? s.ext : undefined,
      requestId: inRequest ? req.id : null,
    };
    if (rec.value === undefined && rec.values === undefined && !rec.ext) { rejected.push({ sensor: s.sensor, reason: 'no_value' }); continue; }
    accepted.push(rec);
    ring.push(rec);
  }
  if (ring.length > L.SENSOR_RING_MAX) ring.splice(0, ring.length - L.SENSOR_RING_MAX);
  _rings.set(device.id, ring);
  const forRequest = req ? accepted.filter(s => s.requestId === req.id).length : 0;
  if (forRequest) { req.sampleCount += forRequest; req.lastSampleAt = now; }
  if (accepted.length) {
    const target = req ? req.requestedBy : null;
    const payload = { deviceId: device.id, requestId: req ? req.id : null, samples: accepted };
    if (target) { try { bus.publish(target, 'sensor.samples', payload); } catch {} }
  }
  return { accepted: accepted.length, rejected };
}

/** Latest sample per sensor for a device. */
function latest(deviceId) {
  const out = {};
  for (const s of _rings.get(deviceId) || []) out[s.sensor] = s;
  return out;
}

function recent(deviceId, requestId, limit = 200) {
  const ring = _rings.get(deviceId) || [];
  return (requestId ? ring.filter(s => s.requestId === requestId) : ring).slice(-limit);
}

function _reset() { _requests.clear(); _rings.clear(); }

module.exports = { createRequest, getRequest, stopRequest, ingest, latest, recent, _reset };
