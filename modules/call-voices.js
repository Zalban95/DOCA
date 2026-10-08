'use strict';

/**
 * A voice per kind of call (asked 2026-10-08: "keep the expressive model for the ambient and the quick calls on the
 * watch, and the dots-themed call. That is the quick one, inside of the one that starts from the chat. That is the
 * Deep one."). Two kinds:
 *
 *   quick — the face's call (assistant mode: the corner face, the wake word), Ambient's call, and a device's call
 *           (`/api/v1/call`: the watch's, a phone's);
 *   deep  — the 🎙 call started from the chat.
 *
 * Each is a slot of the screen-home setting `voice` — `voice.quick`, `voice.deep`: `{service, voice, speed}`, where
 * `service` is '' or 'hive' (the hive's speech service, Settings → Voice) or a speech service of the Services tab
 * (tts-engines.js: the expressive voice) — found on the screen's own layer, then its person's, then the hive's
 * (prefs). A kind with no slot anywhere is today's voice: the screen's own (`voice.engine`, `ttsVoice`, `ttsSpeed`),
 * else the hive's — so nothing changes on an install until somebody chooses.
 *
 * Whether the agent is told of tone tags follows the voice that will speak (tags: the engine's own way, voice-tags.js).
 */
const KINDS = ['quick', 'deep'];

/** The kind of a call the panel or a device names: the face's (assistant) is quick, the chat's (call) is deep. */
function kindOf(mode) {
  if (KINDS.includes(mode)) return mode;
  return mode === 'assistant' ? 'quick' : mode === 'call' ? 'deep' : null;
}

/** A slot that says something: a service, a voice or a speed. */
const said = q => q && typeof q === 'object' && (q.service || q.voice || Number(q.speed) > 0);

/** `voice` on each layer of a screen, top first: [device, person, hive]. */
function layers(deviceId, userId) {
  const screens = require('./screens');
  const prefs = require('./utils').loadPrefs();
  return [
    ['device', deviceId ? screens.layer(deviceId).voice : null],
    ['person', userId ? screens.personLayer(userId).voice : null],
    ['hive', prefs.voice],
  ];
}

/**
 * The voice for one kind of call on one screen: `{engine, voice, speed, tags, kind, from}`. `from` names where it came
 * from — `device`, `person` or `hive` for a kind's own slot, `screen` for the screen's ordinary voice (today's).
 * No kind (a spoken voice message, not a call) is the screen's ordinary voice.
 */
function pick(kind, { deviceId = null, userId = null, mine = null } = {}) {
  const engines = require('./tts-engines');
  let screen = mine;
  if (!screen) { try { screen = deviceId && userId ? require('./screens').effective(deviceId, userId).settings.voice || {} : {}; } catch { screen = {}; } }
  let slot = null, from = 'screen';
  if (KINDS.includes(kind)) {
    for (const [at, v] of layers(deviceId, userId)) if (said(v?.[kind])) { slot = v[kind]; from = at; break; }
  }
  if (!slot) {
    const engine = engines.forVoice(screen);
    return { engine, voice: screen.ttsVoice || '', speed: Number(screen.ttsSpeed) > 0 ? Number(screen.ttsSpeed) : null, tags: !!engine.tags, kind, from };
  }
  // The slot names its service, or keeps the screen's. A voice name belongs to its service: the screen's is kept only
  // when the service is the same one.
  const service = slot.service === 'hive' ? '' : slot.service !== undefined && slot.service !== null ? String(slot.service) : (screen.engine || '');
  const same = service === (screen.engine || '');
  // A voice from a service carries its model and options (hosted-voices/): the slot's own, else the screen's when it is the same service.
  const engine = engines.forVoice({ engine: service, hosted: slot.hosted || (same ? screen.hosted : undefined) });
  const voice = slot.voice || (same ? screen.ttsVoice : '') || '';
  const speed = Number(slot.speed) > 0 ? Number(slot.speed) : same && Number(screen.ttsSpeed) > 0 ? Number(screen.ttsSpeed) : null;
  return { engine, voice, speed, tags: !!engine.tags, kind, from };
}

/** The voice for a kind of call on the screen a request comes from (its browser, or the device that opened it). */
function forRequest(req, kind) {
  const deviceId = req.auth?.session?.screen || req.auth?.session?.deviceId || null;
  return pick(kind, { deviceId, userId: req.auth?.user?.id || null, mine: require('./screens').voiceOf(req) });
}

/** A device's call (`/api/v1/call`): the quick voice of that device's screen, its person's, or the hive's. */
function forDevice(deviceId, kind = 'quick') {
  let d = null;
  try { d = deviceId ? require('./api-v1/devices').get(deviceId) : null; } catch { /* no such device: the hive's */ }
  return pick(kind, { deviceId: d?.id || null, userId: d?.userId || null });
}

module.exports = { KINDS, kindOf, pick, forRequest, forDevice, layers };
