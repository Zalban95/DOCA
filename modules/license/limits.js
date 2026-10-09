'use strict';

/**
 * The licence's seats and devices (terms.js `seats`, `maxDevices`), held in a production hive only (edition-mode.js;
 * the owner's decision of 2026-10-09). A development hive, and a licence that names no number, has no limit.
 *
 *   seats     the people with an active, unsuspended account — the owner included. A new account past it is refused
 *             (auth/users-routes.js), and so is restoring a suspended one (it would take a seat back).
 *   devices   the paired devices that hold a token and are not revoked: phones, watches, desk and browser-extension
 *             clients, linked chats, agents, other hubs — **including one still waiting for approval** (it holds a
 *             token and a place in the list until a person refuses it). A signed-in browser's own record (kind
 *             `browser`, made at sign-in) is not a pairing and never counts: a person signing in is never refused for
 *             it. Refused at the start of a pairing (no code is minted past it) and when a device is made
 *             (api-v1/devices.js create), so no route can go around it.
 *
 * Every refusal is one sentence naming the licence and what to do (free one, or a licence with more).
 */
const count = {
  seats() {
    const store = require('../auth/store');
    const org = store.defaultOrg();
    if (!org) return 0;
    return store.membersOf(org.id).filter(m => m.status === 'active' && !store.userById(m.userId)?.suspendedAt).length;
  },
  devices() {
    return require('../api-v1/devices').list().filter(d => !d.revokedAt && d.kind !== 'browser').length;
  },
};

function terms() {
  const b = require('./index').boot();
  return b.valid ? b.terms : null;
}

/** {seats: {used, max}, devices: {used, max}, enforced} for the panel; max null when the licence names none. */
function status() {
  const t = terms(), enforced = require('../edition-mode').production();
  const safe = f => { try { return f(); } catch { return null; } };
  return { enforced, seats: { used: safe(count.seats), max: t?.seats ?? null }, devices: { used: safe(count.devices), max: t?.maxDevices ?? null } };
}

const who = () => { const t = terms(); return t?.customer ? `${t.customer}'s licence` : 'This hive\'s licence'; };

function refusal(kind, max) {
  if (!require('../edition-mode').production() || !Number.isFinite(max)) return null;
  const used = count[kind]();
  if (used < max) return null;
  const say = kind === 'seats'
    ? `${who()} has ${max} seat${max === 1 ? '' : 's'}, and ${used} ${used === 1 ? 'person has' : 'people have'} an account. Suspend someone who no longer needs one, or ask for a licence with more seats (Settings → System → Licence).`
    : `${who()} allows ${max} device${max === 1 ? '' : 's'}, and ${used} ${used === 1 ? 'is' : 'are'} paired (a device still waiting for approval counts). Remove one in Field → API keys, or ask for a licence with more devices (Settings → System → Licence).`;
  return Object.assign(new Error(say), { status: 409, code: kind === 'seats' ? 'licence_seats' : 'licence_devices' });
}

/** Throws when one more person would pass the licence's seats (production only). */
function checkSeat() { const e = refusal('seats', terms()?.seats); if (e) throw e; }

/** Throws when one more device would pass the licence's devices (production only). A browser's record is never asked. */
function checkDevice(kind) {
  if (kind === 'browser') return;
  const e = refusal('devices', terms()?.maxDevices);
  if (e) throw e;
}

module.exports = { status, checkSeat, checkDevice, count };
