'use strict';

/**
 * Focused and Extended: two faces of one panel (asked 2026-10-12; design "Everyday mode"). Focused is the calm view
 * for people who only want an assistant — Home, a conversation, Calendar and Mail, what was made for them — and
 * Extended is the whole panel as it has always been. Focused only hides pages: every route, tool and setting stays
 * where it was, one tap away.
 *
 * Which one a screen shows is the screen-home setting `panelMode` (settings-schema.js), layered like `skin`:
 * this screen → its person (theirs on every device) → the hive's prefs. A screen nobody chose for takes the default
 * of its person's role: someone holding host (an admin, the owner) starts in Extended, everyone else in Focused.
 * A screen that existed before this was built keeps Extended (migration `3.38-panel-mode-existing`, markExisting()):
 * an update never takes away the panel a person was using.
 *
 * Never proposable: what a person sees of the machine is their own click, not the agent's suggestion.
 */
const MODES = ['focused', 'extended'];
const valid = m => MODES.includes(m);

/** The mode a screen starts in when nobody chose: Extended for a host, Focused for everyone else. */
function roleDefault(role) {
  try { return require('../auth/rights').can(role, 'host') ? 'extended' : 'focused'; } catch { return 'focused'; }
}

/**
 * The mode for one screen and person, and where it came from: `device`, `person`, `hive` or `role`.
 * `effective` is screens.effective()'s answer when the caller already has it.
 */
function resolve(deviceId, user, role, effective = null) {
  const eff = effective || require('./index').effective(deviceId, user?.id);
  const v = eff.settings?.panelMode;
  if (valid(v)) return { mode: v, from: eff.from?.panelMode || 'hive' };
  return { mode: roleDefault(role), from: 'role' };
}

/** Every screen that exists now keeps the panel it showed (Extended): run once by the migration. Returns how many. */
function markExisting() {
  const devices = require('../api-v1/devices'), screens = require('./index');
  let n = 0;
  for (const d of devices.list()) {
    if (d.revokedAt || d.kind === 'agent') continue;
    if (screens.layer(d.id).panelMode !== undefined) continue;
    screens.set(d.id, { panelMode: 'extended' });
    n++;
  }
  return n;
}

module.exports = { MODES, valid, roleDefault, resolve, markExisting };
