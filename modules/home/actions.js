'use strict';

/**
 * What the Home page may ask Home Assistant to do: a short list of services per kind of thing, each with the data it
 * may carry. Home Assistant can do far more (restart itself, run any service of any integration); those stay in HA and
 * with the agent's Home Assistant MCP server, under the agent's own approvals. One entity per call, one that is on the
 * page (index.js shown) and that the person may use (allot `home`). A lock's unlock and an alarm's disarm ask for the
 * password at the gate (auth/guarded.js `guardedCall`).
 */
const home = require('./index');

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

/** Calls that open the house: the gate asks for the password (auth/guarded.js). */
const GUARDED = { lock: ['unlock'], alarm_control_panel: ['alarm_disarm'] };
const guardedCall = body => !!(body && GUARDED[body.domain]?.includes(body.service));

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Checks a request and returns what to send HA, or throws with the reason. */
function check(person, { domain, service, entity_id: id, data = {} } = {}) {
  const services = ALLOW[domain];
  if (!services) throw bad(`The Home page does not act on ${domain || 'that'}; it acts on ${Object.keys(ALLOW).join(', ')}.`);
  const fields = Object.prototype.hasOwnProperty.call(services, service) ? services[service] : null;
  if (!fields) throw bad(`${domain} can be asked to ${Object.keys(services).join(', ')} from here.`);
  if (typeof id !== 'string' || !/^[a-z_]+\.[a-z0-9_]+$/.test(id) || id.split('.')[0] !== domain) throw bad(`entity_id is one ${domain}, like ${domain}.kitchen.`);
  if (!home.stateOf(id) || !home.shown(id)) throw bad(`Home Assistant has no ${id}.`, 404);
  // A script runs whatever its author wrote into it (a door, a heater, a mail): an admin's to run from here.
  if (domain === 'script' && person?.id && !require('../auth/rights').can(person.role, 'host'))
    throw bad(`Running a Home Assistant script is an admin's from here: a script can do anything its author put in it.`, 403);
  if (!home.allowed(person, id)) throw bad(`${id} is not allotted to ${person?.name || 'this person'} — an admin gives it in Settings → Users (the level's Home).`, 403);
  const out = {};
  for (const [k, v] of Object.entries(data && typeof data === 'object' ? data : {})) {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) throw bad(`${domain}.${service} takes ${Object.keys(fields).join(', ') || 'nothing more'} from here, not ${k}.`);
    if (!fields[k](v)) throw bad(`${k} is out of range.`);
    out[k] = v;
  }
  return { domain, service, service_data: out, target: { entity_id: id } };
}

/** Does it: HA's own answer to call_service, which the state_changed that follows draws on every page. */
async function call(person, body) {
  const c = await home.ensure();   // the states are read once connected
  const msg = check(person, body);
  await c.cmd('call_service', msg);
  return { ok: true, entity_id: msg.target.entity_id, service: `${msg.domain}.${msg.service}` };
}

module.exports = { ALLOW, GUARDED, guardedCall, check, call };
