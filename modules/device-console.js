'use strict';

/**
 * A device as a console (the watch's third page): motion, heading, the crown,
 * and three buttons, streamed while the person has switched it on.
 *
 * It is input for *a linked service*, never for the harness: nothing here
 * reaches a model, a prompt or a transcript. The panel links a device to the
 * devices that should receive it (`PUT /api/devices/:id/console`), and each
 * gets `console.input` on its push channel — frames ephemeral (a stream is only
 * worth having live), presses durable for a minute (a button is an intent and
 * must not vanish because a receiver reconnected). The panel also reads the
 * last frames and presses back (`GET /api/devices/:id/console`), which is how
 * a person sees the console working before anything is linked to it.
 *
 * Kept in memory apart from the links (`<DATA_DIR>/device-console.json`): a
 * console stream is live data, and yesterday's accelerometer is nobody's state.
 *
 * Frame: { t (ms since the stream began), accel?: [x, y, z] m/s², heading?: deg
 * 0–360, crown?: accumulated rotary delta since the last frame }.
 */
const store = require('./store');
const DOC = 'device-console';
const FRAMES_KEPT = 120;
const PRESSES_KEPT = 20;
const BATCH_MAX = 64;
const PRESSES = ['A', 'B', 'C'];

const _live = new Map();   // deviceId -> { frames[], presses[], enabled, at }
const links = () => store.readJson(DOC, {});

function stateOf(id) {
  if (!_live.has(id)) _live.set(id, { frames: [], presses: [], enabled: false, at: null });
  return _live.get(id);
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
function cleanFrame(f) {
  if (!f || typeof f !== 'object') return null;
  const out = { t: num(f.t) ?? 0 };
  if (Array.isArray(f.accel) && f.accel.length === 3 && f.accel.every(x => num(x) !== undefined)) out.accel = f.accel.map(Number);
  if (num(f.heading) !== undefined) out.heading = ((f.heading % 360) + 360) % 360;
  if (num(f.crown) !== undefined) out.crown = f.crown;
  return out.accel || out.heading !== undefined || out.crown !== undefined ? out : null;
}

/** One batch from the device. Returns { accepted, linked }. */
function ingest(device, body = {}) {
  const s = stateOf(device.id);
  const frames = (Array.isArray(body.frames) ? body.frames.slice(0, BATCH_MAX) : []).map(cleanFrame).filter(Boolean);
  const press = PRESSES.includes(body.press) ? body.press : null;
  if (typeof body.enabled === 'boolean') s.enabled = body.enabled;
  s.at = new Date().toISOString();
  s.frames.push(...frames);
  if (s.frames.length > FRAMES_KEPT) s.frames.splice(0, s.frames.length - FRAMES_KEPT);
  if (press) {
    s.presses.push({ press, at: s.at });
    if (s.presses.length > PRESSES_KEPT) s.presses.shift();
  }
  const targets = (links()[device.id] || []).filter(id => id !== device.id);
  if (targets.length && (frames.length || press || typeof body.enabled === 'boolean')) {
    const bus = require('./api-v1/bus');
    const payload = { deviceId: device.id, enabled: s.enabled, frames, press };
    for (const id of targets) {
      try { bus.publish(id, 'console.input', payload, press ? { cls: 'durable', ttlSec: 60 } : { cls: 'ephemeral' }); } catch { /* one bad target never stops the rest */ }
    }
  }
  return { accepted: frames.length, press, linked: targets.length };
}

/** The device-side route, on the /api/v1 router after its authentication. */
function mountDevice(router) {
  const { requireScope } = require('./api-v1/auth');
  router.post('/console', requireScope('sensors:report'), (req, res) => res.json(ingest(req.device, req.body || {})));
}

/** The panel's side: see it working, and choose who receives it. */
function mountPanel(app) {
  app.get('/api/devices/:id/console', (req, res) => {
    const s = stateOf(req.params.id);
    res.json({ enabled: s.enabled, at: s.at, frames: s.frames.slice(-40), presses: s.presses, links: links()[req.params.id] || [] });
  });
  app.put('/api/devices/:id/console', (req, res) => {
    const devices = require('./api-v1/devices');
    const ids = (Array.isArray(req.body?.links) ? req.body.links : []).map(String)
      .filter(id => id !== req.params.id && devices.get(id) && !devices.get(id).revokedAt);
    const doc = links();
    doc[req.params.id] = [...new Set(ids)];
    store.writeJson(DOC, doc);
    res.json({ links: doc[req.params.id] });
  });
}

function openapi({ obj, str, int, arr, bool, body, json, std }) {
  const frame = obj({ t: int(), accel: arr({ type: 'number' }), heading: { type: 'number' }, crown: { type: 'number' } });
  return {
    '/console': { post: { tags: ['Devices'], summary: 'Stream console input: motion, heading, crown, A/B/C', operationId: 'postConsole', 'x-scope': 'sensors:report',
      description: 'For the services the panel linked to this device, as `console.input` events. Never reaches the harness.',
      requestBody: body(obj({ frames: arr(frame), press: str({ enum: PRESSES }), enabled: bool() })),
      responses: { 200: json(obj({ accepted: int(), press: str(), linked: int() })), ...std(400, 401, 403) } } },
  };
}

module.exports = { ingest, mountDevice, mountPanel, openapi, _reset: () => _live.clear() };
