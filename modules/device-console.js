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
 * Per console, stored with the links (`<DATA_DIR>/device-console.json`):
 *  - `host`: the hub itself receives it too, which means it runs the buttons'
 *    `run` commands. The file is out of the agent's file tools' reach, and the
 *    buttons are edited under the `host` right: a command a press runs on this
 *    machine is the machine.
 *  - `mode`: `keys` (A/B/C are a small command keyboard: each press carries its
 *    macro) or `joystick` (tilt and crown become axes, A/B/C plain buttons, no
 *    macros). The watch switches it with one tap, so it is a field it may send.
 *  - `buttons.{A,B,C}`: `behaviour` `button` (every press is a press) or
 *    `toggle` (a press latches on, the next off; `down` says which), and the
 *    macro: `keys` for the receiving devices to type, `run` for the host.
 * The stream itself stays in memory: yesterday's accelerometer is nobody's state.
 *
 * Frame: { t (ms since the stream began), accel?: [x, y, z] m/s², heading?: deg
 * 0–360, crown?: accumulated rotary delta since the last frame }.
 */
const os    = require('os');
const store = require('./store');
const DOC = 'device-console';
const FRAMES_KEPT = 120;
const PRESSES_KEPT = 20;
const BATCH_MAX = 64;
const PRESSES = ['A', 'B', 'C'];
const MODES = ['keys', 'joystick'];
const BEHAVIOURS = ['button', 'toggle'];
const RUN_TIMEOUT = 30000;
const G = 9.81;

const _live = new Map();   // deviceId -> { frames[], presses[], enabled, at, toggles, joystick, lastRun }

function stateOf(id) {
  if (!_live.has(id)) _live.set(id, { frames: [], presses: [], enabled: false, at: null, toggles: { A: false, B: false, C: false }, joystick: null, lastRun: null });
  return _live.get(id);
}

const text = v => (typeof v === 'string' ? v.trim().slice(0, 500) : '');

/** A console's settings, with defaults — and read-side for the first shape, which was a bare list of links. */
function configOf(id) {
  let c = store.readJson(DOC, {})[id];
  if (Array.isArray(c)) c = { links: c };
  c = c || {};
  const buttons = {};
  for (const b of PRESSES) {
    const x = c.buttons?.[b] || {};
    buttons[b] = { behaviour: BEHAVIOURS.includes(x.behaviour) ? x.behaviour : 'button', keys: text(x.keys), run: text(x.run) };
  }
  return { links: Array.isArray(c.links) ? c.links : [], host: c.host === true, mode: MODES.includes(c.mode) ? c.mode : 'keys', buttons };
}

function saveConfig(id, patch) {
  const doc = store.readJson(DOC, {});
  doc[id] = { ...configOf(id), ...patch };
  store.writeJson(DOC, doc);
  return configOf(id);
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

/**
 * Tilt as two axes, −1…1 at 90°, in the watch's own axes (x across the face, y
 * along it), and the crown turned since the last batch.
 * ponytail: no dead zone or inversion here; a receiver that wants them applies them.
 */
function joystickOf(frames) {
  const last = [...frames].reverse().find(f => f.accel);
  const crown = frames.reduce((s, f) => s + (f.crown || 0), 0);
  if (!last && !crown) return null;
  const axis = v => Math.round(Math.max(-1, Math.min(1, v / G)) * 1000) / 1000;
  return { x: last ? axis(last.accel[0]) : null, y: last ? axis(last.accel[1]) : null, crown };
}

// ponytail: one run per button at a time; a press while it still runs is dropped, not queued.
const _running = new Set();
/** A button's `run`, on the host, told which button and whether a toggle went on or off. */
function runOnHost(device, button, command, down, s) {
  const key = `${device.id}:${button}`;
  if (_running.has(key)) return;
  _running.add(key);
  const at = new Date().toISOString();
  s.lastRun = { button, at, running: true };
  require('./shell').run(command, { timeout: RUN_TIMEOUT, cwd: os.homedir(),
    env: { DOCA_DEVICE_ID: device.id, DOCA_BUTTON: button, DOCA_BUTTON_STATE: down ? 'on' : 'off' } })
    .then(r => { s.lastRun = { button, at, code: r.code, timedOut: r.timedOut, out: (r.error || r.out).slice(-2000) }; })
    .finally(() => _running.delete(key));
}

/** One batch from the device. Returns what the watch draws: { accepted, press, linked, host, mode, toggles }. */
function ingest(device, body = {}) {
  const s = stateOf(device.id);
  let cfg = configOf(device.id);
  const modeChanged = MODES.includes(body.mode) && body.mode !== cfg.mode;
  if (modeChanged) cfg = saveConfig(device.id, { mode: body.mode });
  const frames = (Array.isArray(body.frames) ? body.frames.slice(0, BATCH_MAX) : []).map(cleanFrame).filter(Boolean);
  const press = PRESSES.includes(body.press) ? body.press : null;
  if (typeof body.enabled === 'boolean') {
    s.enabled = body.enabled;
    if (!body.enabled) s.toggles = { A: false, B: false, C: false };   // nothing stays latched on a console nobody holds
  }
  s.at = new Date().toISOString();
  s.frames.push(...frames);
  if (s.frames.length > FRAMES_KEPT) s.frames.splice(0, s.frames.length - FRAMES_KEPT);

  let button = null, macro = null;
  if (press) {
    const b = cfg.buttons[press];
    const down = b.behaviour === 'toggle' ? (s.toggles[press] = !s.toggles[press]) : true;
    button = { id: press, behaviour: b.behaviour, down };
    s.presses.push({ press, at: s.at, down, mode: cfg.mode });
    if (s.presses.length > PRESSES_KEPT) s.presses.shift();
    if (cfg.mode === 'keys') {
      if (b.keys) macro = { keys: b.keys };
      if (cfg.host && b.run) runOnHost(device, press, b.run, down, s);
    }
  }
  const joystick = cfg.mode === 'joystick' ? joystickOf(frames) : null;
  if (joystick) s.joystick = joystick;

  const targets = cfg.links.filter(id => id !== device.id);
  if (targets.length && (frames.length || press || modeChanged || typeof body.enabled === 'boolean')) {
    const bus = require('./api-v1/bus');
    const payload = { deviceId: device.id, enabled: s.enabled, mode: cfg.mode, frames, press, button, toggles: { ...s.toggles },
      ...(joystick ? { joystick } : {}), ...(macro ? { macro } : {}) };
    for (const id of targets) {
      try { bus.publish(id, 'console.input', payload, press ? { cls: 'durable', ttlSec: 60 } : { cls: 'ephemeral' }); } catch { /* one bad target never stops the rest */ }
    }
  }
  return { accepted: frames.length, press, linked: targets.length, host: cfg.host, mode: cfg.mode, toggles: { ...s.toggles } };
}

/** One line for the agent's doca_clients: that the console exists and where it goes, never what it streams. */
function summary(id, nameOf = x => x) {
  const s = _live.get(id), c = configOf(id);
  if (!s?.at && !c.links.length && !c.host) return null;
  const to = [...c.links.map(nameOf), ...(c.host ? ['host'] : [])];
  return `console=${s?.enabled ? 'on' : 'off'},${c.mode}${to.length ? ` → ${to.join(', ')}` : ' → nobody'}`;
}

/** The device-side route, on the /api/v1 router after its authentication. */
function mountDevice(router) {
  const { requireScope } = require('./api-v1/auth');
  router.post('/console', requireScope('sensors:report'), (req, res) => res.json(ingest(req.device, req.body || {})));
}

/** The panel's side: see it working, choose who receives it and how, and (under `host`) what its buttons do. */
function mountPanel(app) {
  app.get('/api/devices/:id/console', (req, res) => {
    const s = stateOf(req.params.id);
    res.json({ ...configOf(req.params.id), enabled: s.enabled, at: s.at, frames: s.frames.slice(-40), presses: s.presses,
      toggles: s.toggles, joystick: s.joystick, lastRun: s.lastRun });
  });
  app.put('/api/devices/:id/console', (req, res) => {
    const devices = require('./api-v1/devices');
    const b = req.body || {};
    const patch = {};
    if (Array.isArray(b.links)) {
      patch.links = [...new Set(b.links.map(String).filter(id => id !== req.params.id && devices.get(id) && !devices.get(id).revokedAt))];
    }
    if (typeof b.host === 'boolean') patch.host = b.host;
    if (MODES.includes(b.mode)) patch.mode = b.mode;
    res.json(saveConfig(req.params.id, patch));
  });
  // Its own route, so its own right (auth/rights.js): a `run` here is a command on this machine.
  app.put('/api/devices/:id/console/buttons', (req, res) => {
    const cur = configOf(req.params.id).buttons;
    const buttons = {};
    for (const k of PRESSES) buttons[k] = { ...cur[k], ...(req.body?.buttons?.[k] || {}) };
    res.json(saveConfig(req.params.id, { buttons }).buttons);
  });
}

function openapi({ obj, str, int, arr, bool, body, json, std }) {
  const frame = obj({ t: int(), accel: arr({ type: 'number' }), heading: { type: 'number' }, crown: { type: 'number' } });
  return {
    '/console': { post: { tags: ['Devices'], summary: 'Stream console input: motion, heading, crown, A/B/C', operationId: 'postConsole', 'x-scope': 'sensors:report',
      description: 'For the services the panel linked to this device, as `console.input` events. Never reaches the harness. '
        + '`mode` switches between `keys` and `joystick`; the answer carries the mode and the latched toggles for the device to draw.',
      requestBody: body(obj({ frames: arr(frame), press: str({ enum: PRESSES }), enabled: bool(), mode: str({ enum: MODES }) })),
      responses: { 200: json(obj({ accepted: int(), press: str(), linked: int(), host: bool(), mode: str({ enum: MODES }),
        toggles: obj({ A: bool(), B: bool(), C: bool() }) })), ...std(400, 401, 403) } } },
  };
}

module.exports = { ingest, summary, configOf, mountDevice, mountPanel, openapi, DOC, _reset: () => _live.clear() };
