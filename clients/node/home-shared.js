'use strict';

/**
 * What a home looks like and what may be asked of it — one copy, used by the hub (modules/home: tiles.js, actions.js)
 * and by doca-client when it is a home node (home.js), so the Home page draws the same tile and refuses the same call
 * whether the hub talks to Home Assistant itself or a node in the household does (docs/design/home-node.md).
 *
 * A tile is an entity's state and only the attributes a tile needs. Nothing else of HA's state leaves where HA is —
 * `entity_picture` in particular carries an access token in its address, so a camera's picture is fetched with the
 * token by whoever holds it and never linked to.
 *
 * ALLOW is the short list of services per kind of thing, each with the data it may carry. Home Assistant can do far
 * more (restart itself, run any service of any integration); those stay in HA and with the agent's Home Assistant MCP
 * server, under the agent's own approvals. GUARDED are the calls that open the house: the hub asks for the password
 * (auth/guarded.js) or, from the agent, a person every time (harness/forced-asks.js).
 */

/** The kinds of things the page draws, in the order an area shows them. */
const DOMAINS = ['light', 'switch', 'fan', 'cover', 'climate', 'lock', 'media_player', 'alarm_control_panel', 'scene', 'script',
  'camera', 'sensor', 'binary_sensor'];

// Attributes a tile reads, by name; anything not listed stays where HA is.
const ATTRS = ['friendly_name', 'unit_of_measurement', 'device_class', 'brightness', 'color_mode', 'supported_color_modes',
  'current_temperature', 'temperature', 'target_temp_low', 'target_temp_high', 'min_temp', 'max_temp', 'target_temp_step',
  'hvac_mode', 'hvac_modes', 'hvac_action', 'current_position', 'percentage', 'media_title', 'media_artist', 'volume_level',
  'is_volume_muted', 'code_format', 'supported_features', 'icon'];

const ok = v => v === null || ['string', 'number', 'boolean'].includes(typeof v) || (Array.isArray(v) && v.length <= 20 && v.every(x => typeof x === 'string' || typeof x === 'number'));

/** A tile for one HA state ({entity_id, state, attributes, last_changed}), or null for a kind the page does not draw. */
function tileOf(s, reg = {}) {
  if (!/^[a-z_]+\.[a-z0-9_]+$/.test(s?.entity_id || '')) return null;   // HA's own shape; the page puts the id in its buttons
  const domain = s.entity_id.split('.')[0];
  if (!DOMAINS.includes(domain)) return null;
  const a = s.attributes || {};
  const attrs = {};
  for (const k of ATTRS) if (a[k] !== undefined && ok(a[k])) attrs[k] = typeof a[k] === 'string' ? a[k].slice(0, 200) : a[k];
  delete attrs.friendly_name;
  return { id: s.entity_id, domain, name: String(reg?.name || a.friendly_name || s.entity_id).slice(0, 120), state: String(s.state ?? 'unknown').slice(0, 120),
    attrs, changed: s.last_changed || null };
}

/** Whether the registry keeps an entity off a person's view: disabled, hidden, or a device's own settings and diagnostics. */
const hiddenByRegistry = r => !!(r && (r.disabled_by || r.hidden_by || r.entity_category));

const num = (lo, hi) => v => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const oneOf = (...xs) => v => xs.includes(v);
const str = max => v => typeof v === 'string' && v.length <= max;
const bool = v => typeof v === 'boolean';

const ON_OFF = { turn_on: {}, turn_off: {}, toggle: {} };
const ALLOW = {
  light: { turn_on: { brightness_pct: num(0, 100), brightness: num(0, 255), color_temp_kelvin: num(1000, 12000) }, turn_off: {}, toggle: {} },
  switch: ON_OFF,
  fan: { ...ON_OFF, set_percentage: { percentage: num(0, 100) } },
  cover: { open_cover: {}, close_cover: {}, stop_cover: {}, set_cover_position: { position: num(0, 100) } },
  climate: { set_temperature: { temperature: num(-50, 150), target_temp_low: num(-50, 150), target_temp_high: num(-50, 150), hvac_mode: str(30) },
    set_hvac_mode: { hvac_mode: oneOf('off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only') }, turn_on: {}, turn_off: {} },
  lock: { lock: {}, unlock: { code: str(40) } },
  media_player: { media_play: {}, media_pause: {}, media_play_pause: {}, media_stop: {}, media_next_track: {}, media_previous_track: {},
    volume_set: { volume_level: num(0, 1) }, volume_mute: { is_volume_muted: bool }, turn_on: {}, turn_off: {} },
  scene: { turn_on: {} },
  script: { turn_on: {} },
  alarm_control_panel: { alarm_arm_home: { code: str(40) }, alarm_arm_away: { code: str(40) }, alarm_arm_night: { code: str(40) }, alarm_disarm: { code: str(40) } },
};

/** Calls that open the house. */
const GUARDED = { lock: ['unlock'], alarm_control_panel: ['alarm_disarm'] };
const guardedCall = body => !!(body && GUARDED[body.domain]?.includes(body.service));

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/**
 * The list's half of checking a call, the same wherever HA is: the kind, the service, the entity's shape and the data
 * each service takes. Returns HA's call_service message, or throws with the reason. Whether the entity exists, is on
 * the page and is the person's is the caller's half.
 */
function checkCall({ domain, service, entity_id: id, data = {} } = {}) {
  const services = Object.prototype.hasOwnProperty.call(ALLOW, domain) ? ALLOW[domain] : null;
  if (!services) throw bad(`The Home page does not act on ${domain || 'that'}; it acts on ${Object.keys(ALLOW).join(', ')}.`);
  const fields = Object.prototype.hasOwnProperty.call(services, service) ? services[service] : null;
  if (!fields) throw bad(`${domain} can be asked to ${Object.keys(services).join(', ')} from here.`);
  if (typeof id !== 'string' || !/^[a-z_]+\.[a-z0-9_]+$/.test(id) || id.split('.')[0] !== domain) throw bad(`entity_id is one ${domain}, like ${domain}.kitchen.`);
  const out = {};
  for (const [k, v] of Object.entries(data && typeof data === 'object' ? data : {})) {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) throw bad(`${domain}.${service} takes ${Object.keys(fields).join(', ') || 'nothing more'} from here, not ${k}.`);
    if (!fields[k](v)) throw bad(`${k} is out of range.`);
    out[k] = v;
  }
  return { domain, service, service_data: out, target: { entity_id: id } };
}

module.exports = { DOMAINS, ATTRS, tileOf, hiddenByRegistry, ALLOW, GUARDED, guardedCall, checkCall };
