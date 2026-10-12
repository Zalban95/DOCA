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
 * A screen that existed before this was built and belongs to someone holding host (an admin, the owner — or no one, a
 * screen from before accounts) keeps Extended (migration `3.42-panel-mode-existing`, markExisting()); a member's goes by
 * role, to Focused, and switches back in one tap (the owner's decision, 2026-10-12).
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

/** Whether a screen's person holds host in any of their organisations (no person: a screen from before accounts). */
function hostsScreen(d) {
  if (!d.userId) return true;
  try {
    return require('../auth/store').membershipsOf(d.userId).some(m => m.status !== 'suspended' && require('../auth/rights').can(m.role, 'host'));
  } catch { return false; }
}

/** Every screen of an admin's that exists now keeps the panel it showed (Extended): run once by the migration. Returns how many. */
function markExisting() {
  const devices = require('../api-v1/devices'), screens = require('./index');
  let n = 0;
  for (const d of devices.list()) {
    if (d.revokedAt || d.kind === 'agent' || !hostsScreen(d)) continue;
    if (screens.layer(d.id).panelMode !== undefined) continue;
    screens.set(d.id, { panelMode: 'extended' });
    n++;
  }
  return n;
}

/** For a paired device (GET /api/v1/settings/effective): the mode its screen shows and where that came from
 *  (`device`, `person`, `hive` or `role` — the role of the device's person in its organisation). */
function forDevice(d, effective) {
  let role = null;
  try {
    const store = require('../auth/store');
    const m = (d.orgId && d.userId && store.membership(d.orgId, d.userId)) || (d.userId ? store.membershipsOf(d.userId)[0] : null);
    role = m?.role || (d.userId ? null : 'owner');   // no person: a device from before accounts, the owner's
  } catch { /* by the default */ }
  const r = resolve(d.id, d.userId ? { id: d.userId } : null, role, effective);
  return { mode: r.mode, source: r.from };
}

module.exports = { MODES, valid, roleDefault, resolve, forDevice, markExisting, hostsScreen };
