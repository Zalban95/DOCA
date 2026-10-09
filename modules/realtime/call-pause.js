'use strict';

/**
 * How long a pause ends what was said in a device's call (2026-10-09, from a watch: "the waits are too quick, so my
 * pauses usually let the thinking start"). The hub's own engine (pipeline.js) used a fixed 900 ms; now it is the same
 * setting the panel's call reads — `call.silenceMs`, Settings → Voice → Calls, "the pause that sends what you said" —
 * from the device's own screen layer, then its person's, then the hive's (screens.effective), and when none sets it a
 * device's default, longer than the panel's old one: a wrist is spoken to in pieces.
 *
 * A pause shorter than this never cuts: speech that resumes inside it is the same utterance (pipeline.js counts quiet
 * only since the last voiced frame).
 */
const MIN_MS = 300, MAX_MS = 10000;

/** A value as a pause: whole milliseconds within bounds, or null for one that says nothing. */
function clamp(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(Math.min(MAX_MS, Math.max(MIN_MS, n)));
}

/** `{silenceMs, from}` for a paired device: `from` is device, person, hive or default. */
function forDevice(deviceId) {
  const fallback = { silenceMs: require('./pipeline').DEFAULT_SILENCE_MS, from: 'default' };
  try {
    const d = deviceId && require('../api-v1/devices').get(deviceId);
    if (!d) return fallback;
    const eff = require('../screens').effective(d.id, d.userId || null);
    const ms = clamp(eff.settings.call?.silenceMs);
    return ms ? { silenceMs: ms, from: eff.from.call || 'hive' } : fallback;
  } catch { return fallback; }
}

module.exports = { forDevice, clamp, MIN_MS, MAX_MS };
