'use strict';

/**
 * What the Home page draws of one Home Assistant entity: a tile, made from its state and only the attributes a tile
 * needs. Nothing else of HA's state leaves the hub — `entity_picture` in particular carries an access token in its
 * address, so a camera's picture is fetched by the hub (index.js camera()) and never linked to.
 */

/** The kinds of things the page draws, in the order an area shows them. */
const DOMAINS = ['light', 'switch', 'fan', 'cover', 'climate', 'lock', 'media_player', 'alarm_control_panel', 'scene', 'script',
  'camera', 'sensor', 'binary_sensor'];

// Attributes a tile reads, by name; anything not listed stays on the hub.
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
  return { id: s.entity_id, domain, name: String(reg.name || a.friendly_name || s.entity_id).slice(0, 120), state: String(s.state ?? 'unknown').slice(0, 120),
    attrs, changed: s.last_changed || null };
}

/** Whether the registry keeps an entity off a person's view: disabled, hidden, or a device's own settings and diagnostics. */
const hiddenByRegistry = r => !!(r && (r.disabled_by || r.hidden_by || r.entity_category));

module.exports = { DOMAINS, tileOf, hiddenByRegistry };
