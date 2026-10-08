'use strict';

/**
 * Where a screen is, for the weather (2026-10-08: a fresh Ambient, and the agent's `today`, said "no place set" to a
 * person holding a phone that knows exactly where it is). In order: the place asked for; the town the screen was given
 * (`ambient.place`); the position its own device reports — a paired device's `location` sensor sample, else the one
 * the ambient page last kept (`ambient.here`: it asks the browser, or DOCA's phone app's WebView, and names it through a
 * reverse lookup); the hive's `ambient.place`.
 * Each answer says which it was, so the agent can say whose place it used.
 */

/** The screen's ambient settings (hive → person → device), or {} for a turn with no screen. */
function settingsOf(screen, userId) {
  if (!screen) return {};
  try { return require('../screens').effective(screen, userId || null).settings.ambient || {}; } catch { return {}; }
}

/** A kept position, as the "lat,lon" weather.js takes, or ''. */
function hereOf(here) {
  const lat = Number(here?.lat), lon = Number(here?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? `${lat.toFixed(3)},${lon.toFixed(3)}` : '';
}

const FRESH_MS = 6 * 3600000;

/** A paired device's last `location` sample (PROTOCOL §sensors: values [lat, lon, alt?]) from the last six hours, or ''. */
function reported(deviceId) {
  try {
    const s = require('../api-v1/sensors').latest(deviceId).location;
    if (!s || Date.now() - Date.parse(s.ts) > FRESH_MS) return '';
    return hereOf({ lat: s.values?.[0] ?? s.ext?.lat, lon: s.values?.[1] ?? s.ext?.lon });
  } catch { return ''; }
}

/**
 * {place, from, name?}: `place` is what weather.forecast takes ('' for none); `from` is asked | screen | device | hive
 * | null; `name` is the town a kept position was named as.
 */
function resolve({ place = '', screen = null, userId = null } = {}) {
  const asked = String(place || '').trim();
  if (asked) return { place: asked, from: 'asked' };
  const s = settingsOf(screen, userId);
  if (String(s.place || '').trim()) return { place: s.place.trim(), from: 'screen' };
  if (s.auto !== false) {
    const sampled = reported(screen);
    if (sampled) return { place: sampled, from: 'device' };
    const here = hereOf(s.here);
    if (here) return { place: here, from: 'device', name: s.here?.name || null };
  }
  const hive = String(require('../settings-schema').value('ambient.place') || '').trim();
  if (hive) return { place: hive, from: 'hive' };
  return { place: '', from: null };
}

/** How the agent says it: "Pesaro, IT — this screen's own position". */
const FROM = { asked: 'the place asked for', screen: 'this screen\'s place', device: 'this device\'s own location', hive: 'the hive\'s place' };
const said = from => FROM[from] || '';

module.exports = { resolve, hereOf, reported, said, settingsOf };
