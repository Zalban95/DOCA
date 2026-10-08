'use strict';

/**
 * Whose devices a person manages from the panel (deep test A #6; decided by the owner 2026-10-08, S11).
 *
 * A level that reaches "own devices" (auth/reach.js) promised a member their own phone's tools, and every
 * /api/devices route needed the `devices` right, so a member could never pair one. Now the routes a person needs
 * for their own devices — the list, pairing, rename, rotate, revoke — are `chat` in rights.js, and this decides
 * what each request may touch:
 *   all   the `devices` right (an admin), from where the machine's rights hold (network.limited): every device,
 *         every preset, and pairing for someone else
 *   own   chat and a reach of own-devices or more: only devices recorded as theirs (another's is a 404, as a
 *         conversation is), only the presets no wider than a phone's, the device always recorded as theirs
 *   none  anyone else (a level that reaches only `create`): refused
 * What a member's device may then do through /api/v1 is held to its person in api-v1/owner-ceiling.js.
 */
const rights = require('./auth/rights');

/** The presets a person pairs for themselves: a phone (also DocaDesk and doca-client), a watch, the browser extension. */
const OWN_PRESETS = ['phone', 'watch', 'extension'];

const levelOf = role => require('./auth/levels').get(role);

/** Whether a level lets its holders pair and keep devices of their own. */
function pairsOwn(role) {
  if (!rights.can(role, 'chat')) return false;
  return ['own-devices', 'anything'].includes(require('./auth/reach').rungOf(levelOf(role)));
}

/** 'all', 'own' or null for this request's person (req.auth). */
function scopeOf(req) {
  const role = req.auth?.role;
  if (!role) return null;
  if (rights.can(role, 'devices') && !require('./network').limited(req, 'devices')) return 'all';
  return pairsOwn(role) ? 'own' : null;
}

/** The scope, or answers 403 and returns null. */
function require_(req, res) {
  const s = scopeOf(req);
  if (!s) res.status(403).json({ code: 'forbidden', error: `Your level (${req.auth?.role || 'none'}) does not reach devices, so it cannot pair or keep one. An admin can change the level's reach in Settings → Users.` });
  return s;
}

const isMine = (req, d) => !!d && !!d.userId && d.userId === req.auth?.user?.id;

/** The device this request may act on, or null (the caller answers 404: another person's device is not there). */
function deviceFor(req, scope, id) {
  const d = require('./api-v1/devices').get(id);
  if (!d) return null;
  return scope === 'all' || isMine(req, d) ? d : null;
}

/** The presets this scope may pair with: every one for an admin, the phone-sized ones otherwise. */
function presets(scope) {
  const { PRESETS } = require('./api-v1/scopes');
  return scope === 'all' ? PRESETS : Object.fromEntries(OWN_PRESETS.filter(p => PRESETS[p]).map(p => [p, PRESETS[p]]));
}

/**
 * Whose a new device is, and with what it may pair: { userId, orgId, scope } or throws {status, message}.
 * A person pairing their own: themselves, whatever the body says. An admin: themselves, or `forUser` — a person of
 * this organisation, whose own scope then bounds the presets (an admin cannot hand a member an admin token).
 */
function ownerFor(req, scope, forUser) {
  const store = require('./auth/store');
  const me = { userId: req.auth.user.id, orgId: req.auth.orgId || null, scope };
  if (!forUser || forUser === me.userId) return me;
  if (scope !== 'all') throw Object.assign(new Error('Only an admin pairs a device for someone else.'), { status: 403 });
  const m = store.userById(forUser) && store.membership(req.auth.orgId, forUser);
  if (!m || m.status === 'suspended') throw Object.assign(new Error('There is no such person here.'), { status: 400 });
  const theirs = rights.can(m.role, 'devices') ? 'all' : pairsOwn(m.role) ? 'own' : null;
  if (!theirs) throw Object.assign(new Error(`Their level (${m.role}) does not reach devices: change its reach first (Settings → Users).`), { status: 400 });
  return { userId: forUser, orgId: req.auth.orgId || null, scope: theirs };
}

/** One line in the audit log, with the person who did it and whose device it was. */
function audit(req, action, d, extra = '') {
  try {
    require('./auth/store').audit({ orgId: req.auth?.orgId, actorId: req.auth?.user?.id, subjectId: d?.userId || null,
      action, detail: `${d?.id || ''}${d?.name ? ` (${d.name})` : ''}${extra ? ` ${extra}` : ''}`.trim() });
  } catch { /* the audit never breaks the request */ }
}

module.exports = { OWN_PRESETS, pairsOwn, scopeOf, require: require_, isMine, deviceFor, presets, ownerFor, audit };
