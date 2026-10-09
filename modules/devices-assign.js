'use strict';

/**
 * Giving a device that belongs to nobody to a person (the owner's yes, 2026-10-09). Devices paired before accounts
 * existed have no `userId`: their own page /d/<id>/ refuses everyone, and they follow no person's level (owner-ceiling
 * keeps what a person-less device holds). An admin assigns one here:
 *
 *   POST /api/devices/:id/assign {userId, dryRun?}   the `devices` right (rights.js), from where the machine's rights hold
 *                                           (devices-own.js scope `all`); dryRun says what it would drop
 *
 *   only an ownerless device   one that belongs to someone is never moved to another person — refused with a sentence
 *                              (revoke it and pair it again for them); a browser or a linked chat always has its person
 *   to a person who may keep devices   their level reaches devices (devices-own.js), as pairing for someone does
 *   held to their level        the stored scopes are narrowed the way approving a device does (owner-ceiling
 *                              `ceilingFor` with their role) and what was dropped is said; from then on `narrow` holds
 *                              it to their level on every request, like their other devices
 *   written down               the audit log, an activity line (Chronicle's source hub), the live topic `device`
 *
 * The panel's alone (capability-map.js `device-assign`): re-owning an old device is an admin's decision at the panel.
 */
const devices = require('./api-v1/devices');
const own = require('./devices-own');
const rights = require('./auth/rights');

const fail = (message, status) => Object.assign(new Error(message), { status });
const nameOf = u => u?.name || u?.email || u?.id || 'someone';

/**
 * Give device `id` to person `userId`, as the admin on `req`. Returns { device, dropped, person }. `dryRun`: every check,
 * and what it would drop, with nothing written — the panel's question says it before the admin says yes.
 */
function assign(req, id, userId, { dryRun = false } = {}) {
  if (own.scopeOf(req) !== 'all') throw fail('Only an admin (the devices right, from where the machine\'s rights hold) gives a device to a person.', 403);
  const d = devices.get(String(id || ''));
  if (!d) throw fail('There is no such device.', 404);
  if (d.revokedAt) throw fail(`${d.name} is revoked: pair the device again for that person instead.`, 409);
  const store = require('./auth/store');
  if (d.userId) {
    const theirs = store.userById(d.userId);
    throw fail(d.userId === userId ? `${d.name} is already ${nameOf(theirs)}'s.`
      : `${d.name} already belongs to ${nameOf(theirs)}: a device is never moved from one person to another. Revoke it and pair it again for the other person.`, 409);
  }
  if (!userId) throw fail('Whose should it be? Choose a person.', 400);
  const orgId = req.auth?.orgId || store.defaultOrg()?.id || null;
  const u = store.userById(String(userId));
  const m = u && store.membership(orgId, u.id);
  if (!m || m.status !== 'active' || u.suspendedAt) throw fail('There is no such person here.', 400);
  if (!rights.can(m.role, 'devices') && !own.pairsOwn(m.role))
    throw fail(`${nameOf(u)}'s level (${m.role}) does not reach devices, so they cannot keep one: change the level's reach first (Settings → Users).`, 400);
  const held = d.scopes || [];
  const kept = require('./api-v1/owner-ceiling').ceilingFor(held, m.role);
  const dropped = held.filter(s => !kept.includes(s));
  const person = { id: u.id, name: nameOf(u), level: m.role };
  if (dryRun) return { device: devices.publicView(d), dropped, person, dryRun: true };
  const next = devices.update(d.id, { userId: u.id, orgId, scopes: kept });
  const without = dropped.length ? ` without ${dropped.join(', ')} (beyond their level)` : '';
  own.audit(req, 'device assigned', next, `to ${nameOf(u)}${without}`);
  try {
    require('./activity').note({ from: 'devices', what: `${d.name} given to ${nameOf(u)}`, why: `it belonged to nobody; ${nameOf(req.auth?.user)} gave it to them at the panel, held to their level (${m.role})${without}`,
      person: { id: u.id, name: nameOf(u) } });
  } catch { /* the line never breaks the change */ }
  require('./live').changed('device', d.id, 'assigned', { personId: u.id });
  return { device: next, dropped, person };
}

function mount(app) {
  app.post('/api/devices/:id/assign', (req, res) => {
    if (!require('./devices-panel').legacyTrusted()) return res.status(403).json({ error: 'Managing devices from the dashboard is disabled (DOCA_LEGACY_TRUST=0).' });
    try { res.json(assign(req, req.params.id, req.body?.userId, { dryRun: req.body?.dryRun === true })); }
    catch (e) { res.status(e.status || 500).json({ code: e.status === 409 ? 'owned' : e.status === 403 ? 'forbidden' : 'error', error: e.message }); }
  });
}

module.exports = { assign, mount };
