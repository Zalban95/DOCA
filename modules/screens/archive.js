'use strict';

/**
 * A browser nobody opened for a week goes to the Archive (the owner's yes, 2026-10-09). Every sign-in makes a browser
 * record (screens/index.js), and the Devices list filled with "Chrome on Linux" rows of browsers long closed.
 *
 *   seen       a browser's sign-in session at work (/api/screen, the presence beat) stamps its record's `lastSeenAt`,
 *              at most every ten minutes — a browser has no token, so nothing else would
 *   the sweep  a browser record not seen for `devices.browserArchiveDays` (7; 0 = never; the owner's, not proposable)
 *              is put away: `archivedAt`, out of the Devices list, kept in Agents → Archive (kind `device`), and every
 *              sign-in session bound to it ended — so that browser signs in again. Only kind `browser`: phones,
 *              watches, desks, clients and linked chats are never put away by this. Every 6 hours from
 *              boot.afterListen, one activity line when any went.
 *   back       signing in again from it (its `doca_screen` cookie names the record) brings the record back with its
 *              look and settings instead of making a new one (screens.ensure); so does Restore in the Archive.
 */
const devices = require('../api-v1/devices');

const SEEN_EVERY_MS = 10 * 60e3;
const SWEEP_MS = 6 * 3600e3;
const DAY_MS = 86400e3;
let _sweeper = null;

const isBrowser = d => !!d && d.kind === 'browser';

/** The newest sign of life: the record's own stamp, a session bound to it, or when it was made. */
function lastSeen(d) {
  let t = Math.max(Date.parse(d.lastSeenAt || '') || 0, Date.parse(d.createdAt || '') || 0);
  if (d.userId) {
    try {
      for (const s of require('../auth/store').sessionsOf(d.userId))
        if (s.screen === d.id) t = Math.max(t, Date.parse(s.lastSeenAt || s.createdAt || '') || 0);
    } catch { /* accounts unavailable: the record's own stamp */ }
  }
  return t;
}

/** A browser's session at work: stamp its record (throttled), and bring it back if it was put away. */
function seen(id, now = Date.now()) {
  const d = id && devices.get(id);
  if (!isBrowser(d) || d.revokedAt) return;
  if (d.archivedAt) return restore(d.id, { why: 'signed in again from it' });
  if (now - (Date.parse(d.lastSeenAt || '') || 0) >= SEEN_EVERY_MS) devices.update(d.id, { lastSeenAt: new Date(now).toISOString() });
}

/** End every sign-in session bound to this browser record. Returns how many. */
function signOut(d) {
  if (!d?.userId) return 0;
  const store = require('../auth/store');
  let n = 0;
  try { for (const s of store.sessionsOf(d.userId)) if (s.screen === d.id) { store.deleteSession(s.tokenHash); n++; } } catch { /* nothing to end */ }
  return n;
}

const whose = d => { try { const u = d.userId && require('../auth/store').userById(d.userId); return u ? { id: u.id, name: u.name || u.email || u.id } : null; } catch { return null; } };

/** Put a browser record away: out of the Devices list, its sign-in ended. Throws for anything that is not a browser. */
function archive(id, { now = Date.now() } = {}) {
  const d = devices.get(id);
  if (!isBrowser(d)) throw Object.assign(new Error('Only a signed-in browser\'s record is put away in the Archive; revoke any other device in the Devices list.'), { status: 400 });
  if (d.archivedAt) return devices.publicView(d);
  const next = devices.update(id, { archivedAt: new Date(now).toISOString() });
  signOut(d);
  require('../live').changed('device', id, 'archived', { personId: d.userId || null });
  return next;
}

/** Bring a browser record back to the Devices list (its person signs in again to use it). */
function restore(id, { why = '' } = {}) {
  const d = devices.get(id);
  if (!isBrowser(d)) throw Object.assign(new Error('No such browser in the Archive.'), { status: 404 });
  if (!d.archivedAt) return devices.publicView(d);
  const next = devices.update(id, { archivedAt: null, lastSeenAt: new Date().toISOString() });
  if (why) try { require('../activity').note({ from: 'devices', what: `${d.name} is back from the Archive`, why, person: whose(d) }); } catch { /* never breaks a sign-in */ }
  require('../live').changed('device', id, 'restored', { personId: d.userId || null });
  return next;
}

/** The hub's own pass: every browser record unseen for the setting's days. One activity line when any went. */
function sweep(now = Date.now()) {
  const days = Number(require('../settings-schema').value('devices.browserArchiveDays')) || 0;
  if (days <= 0) return [];
  const gone = [];
  for (const d of devices.list())
    if (isBrowser(d) && !d.revokedAt && !d.archivedAt && now - lastSeen(d) > days * DAY_MS) { archive(d.id, { now }); gone.push(d); }
  if (gone.length) require('../activity').note({ from: 'devices', what: `put away ${gone.length} browser${gone.length === 1 ? '' : 's'} nobody opened for ${days} day${days === 1 ? '' : 's'}`,
    why: `devices.browserArchiveDays is ${days}: their sign-in ended; signing in again from one brings it back (Agents → Archive): ${gone.map(d => d.name).join(', ')}` });
  return gone;
}

function start() {
  if (_sweeper) return;
  try { sweep(); } catch { /* the next pass tries again */ }
  _sweeper = setInterval(() => { try { sweep(); } catch { /* the next pass tries again */ } }, SWEEP_MS);
  _sweeper.unref?.();
}

module.exports = { seen, archive, restore, sweep, start, lastSeen, signOut, SWEEP_MS };
