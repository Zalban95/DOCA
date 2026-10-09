'use strict';

/**
 * Who may approve a new device (the owner's decision of 2026-10-09, CONSTITUTION S11): a level's `approveDevices`.
 *
 *   none    its people approve no device — not even their own; an admin (or someone who may) decides
 *   own     its people approve their own new devices, one tap
 *   anyone  its people approve anyone's
 *
 * Built-ins: Main admin and Admin `anyone`, Member `own`, Viewer `none`. A level that does not say is read from what
 * it holds: the devices right is `anyone`, a level whose people keep devices of their own (devices-own.js) `own`,
 * anything else `none`. A level made by someone never approves further than they do.
 *
 * Approving gives the device at most what the approver holds and what its own person holds (api-v1/owner-ceiling.js
 * `ceilingFor`); the state and the asking are devices-approval/.
 */
const RUNGS = ['none', 'own', 'anyone'];

const levels = () => require('./levels');

/** The rung of a level (an object or an id); an unknown level approves nothing. */
function rungOf(level) {
  const l = typeof level === 'string' ? levels().get(level) : level;
  if (!l) return 'none';
  if (RUNGS.includes(l.approveDevices)) return l.approveDevices;
  if ((l.rights || []).includes('devices')) return 'anyone';
  return l.id && require('../devices-own').pairsOwn(l.id) ? 'own' : 'none';
}

/** A level's stored value: one of RUNGS, never past the actor's own rung. null when not given (read from its rights). */
function normalize(value, actorLevel) {
  if (value === undefined || value === null || value === '') return null;
  if (!RUNGS.includes(value)) throw Object.assign(new Error(`New devices: one of ${RUNGS.join(', ')}.`), { status: 400 });
  const mine = rungOf(actorLevel);
  if (RUNGS.indexOf(value) > RUNGS.indexOf(mine))
    throw Object.assign(new Error(`You cannot make a level that approves more devices than you do (${mine}).`), { status: 403 });
  return value;
}

/**
 * Whether a person ({ id, role }) may approve `device`, at `rung` when the request narrows it (a sign-in from
 * outside the tailnet keeps only `own`, as it keeps no machine right).
 */
function mayApprove(person, device, rung = rungOf(person?.role)) {
  if (!person?.id || !device) return false;
  if (rung === 'anyone') return true;
  return rung === 'own' && !!device.userId && device.userId === person.id;
}

/** Everyone who may approve `device`: [{ id, name, role, own }] — `own` when it is their own device. */
function approversOf(device) {
  const store = require('./store');
  const org = device?.orgId || store.defaultOrg()?.id;
  if (!org) return [];
  const out = [];
  for (const m of store.membersOf(org)) {
    if (m.status !== 'active') continue;
    const u = store.userById(m.userId);
    if (!u || u.suspendedAt) continue;
    const p = { id: u.id, role: m.role };
    if (mayApprove(p, device)) out.push({ id: u.id, name: u.name || u.email || u.id, role: m.role, own: u.id === device.userId });
  }
  return out;
}

/** "Mia (its person), Al" — whoever was asked, in the words a waiting device and a refusal say. */
function sayWho(list) {
  if (!list.length) return 'nobody here can approve it yet — an admin can let a level approve devices in Settings → Users';
  const own = list.filter(a => a.own).map(a => `${a.name} (its person)`);
  const others = list.filter(a => !a.own).map(a => a.name);
  return [...own, ...others].join(', ');
}

module.exports = { RUNGS, rungOf, normalize, mayApprove, approversOf, sayWho };
