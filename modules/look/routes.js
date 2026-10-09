'use strict';

/**
 * A device's settings and look on /api/v1 (PROTOCOL §14.1): `GET /settings/effective` is its screen settings over
 * its person's and the hive's (screens/), `GET /settings/look` the panel's look those settings draw, resolved
 * (look/resolve.js) so an app's own screens can match the panel. `settings.changed` tells a device its layer or its
 * person's changed (screens.set / setPerson), so it reads them again.
 */
const screens = () => require('../screens');
const { resolve } = require('./resolve');

const LOOK_KEYS = ['theme', 'customTheme', 'skin'];

/** The look of a device's effective settings, with which layer each of its keys came from. */
function lookFor(deviceId, userId) {
  const eff = screens().effective(deviceId, userId);
  const from = Object.fromEntries(LOOK_KEYS.map(k => [k, eff.from[k] || 'default']));
  return { ...resolve(eff.settings), from };
}

function mountDevice(router) {
  router.get('/settings/effective', (req, res) => res.json({ deviceId: req.device.id, ...screens().effective(req.device.id, req.device.userId) }));
  router.get('/settings/look', (req, res) => {
    try { res.json({ deviceId: req.device.id, look: lookFor(req.device.id, req.device.userId) }); }
    catch (e) { res.status(500).json({ error: { code: 'look_unavailable', message: `The panel's look could not be read: ${e.message}` } }); }
  });
}

/** Tell the devices a layer belongs to that it changed: a device's own (not a browser: it has no stream), or each
 *  paired device of a person's. Never throws: a setting is saved whether or not anyone hears of it. */
function announce(layer, id, keys) {
  try {
    const devices = require('../api-v1/devices'), bus = require('../api-v1/bus');
    const payload = { layer, keys, look: keys.some(k => LOOK_KEYS.includes(k)), url: '/api/v1/settings/effective', lookUrl: '/api/v1/settings/look' };
    const mine = d => d.kind !== 'browser' && (layer === 'device' ? d.id === id : d.userId === id);
    bus.publishWhere(devices.list(), mine, 'settings.changed', payload);
  } catch { /* the bus is down or a test has none: the device reads them at its next connection */ }
}

function openapi({ obj, str, json, std }) {
  const arr = items => ({ type: 'array', items });
  const any = { type: 'object', additionalProperties: true };
  const num = { type: ['number', 'null'] };
  const look = obj({
    theme: str({ description: 'The theme in use: a name from the panel\'s list, or `custom`.' }), themeLabel: str(),
    skin: str({ enum: ['classic', 'modern', 'points'], description: 'The style: Classic (mono, square), Modern (sans, rounded), Points (Plex Sans, calm).' }), skinLabel: str(),
    ground: str({ enum: ['light', 'dark'] }),
    palette: { type: 'object', additionalProperties: { type: 'string' }, description: 'Hex colours by role: bg, surface, raised, dim, faint, border, border2, text, muted, bright, accent, green, red, blue, purple, teal, cyan, amber, bgGreen, bgRed, bgBlue, bgAmber, bg2, bg3, onAccent, stopped, field. A role the panel does not draw is absent; draw it from the nearest.' },
    fonts: obj({ ui: arr(str()), text: arr(str()), display: arr(str()), mono: arr(str()) }),
    radius: obj({ control: num, card: num }), inputSize: num,
    from: any, etag: str({ description: 'Changes when anything above does.' }),
  });
  return {
    '/settings/look': { get: { tags: ['Discovery'], summary: 'The panel\'s look for this device, resolved', operationId: 'getSettingsLook',
      description: 'The theme and style this device\'s effective settings (`theme`, `customTheme`, `skin`) draw in the panel, as colours, fonts and corners an app can draw its own screens in. Computed from the panel\'s own theme table. `from` says which layer each key came from (device, person, hive, default). Read it again on `settings.changed` with `look: true` and at each connection. Any token.',
      responses: { 200: json(obj({ deviceId: str(), look })), ...std(401) } } },
  };
}

/** The `settings.changed` event for the OpenAPI x-events catalogue. */
function events({ obj, str, bool, arr }) {
  return { 'settings.changed': { audience: 'device', payload: obj({ layer: str({ enum: ['device', 'person'] }), keys: arr(str()), look: bool(), url: str(), lookUrl: str() }),
    note: 'This device\'s screen settings, or its person\'s, changed: read `url` again, and `lookUrl` when `look` is true. A change to the hive\'s defaults is not announced; read both at each connection.' } };
}

module.exports = { mountDevice, announce, lookFor, openapi, events, LOOK_KEYS };
