'use strict';

/**
 * A view link (docs/design/cast-and-devices.md; the owner's yes of 2026-10-12, S11): a screen that cannot sign in — a
 * TV's browser, a monitor's mini PC, a tablet on a wall — opens one link and shows one page, read-only. The link is a
 * one-time code, good for ten minutes; opening it makes a screen record of its own (kind browser, the caster's, named
 * for what it shows) and a session for it whose only right is `view:<page>` (cast/views.js decides what that reads),
 * as the caster — so it shows what the caster's level shows and never more, acts on nothing and opens no socket.
 * Revoking that screen (Devices, or Stop on the cast) signs it out, as for any browser (credentials.resolveHash).
 */
const crypto = require('crypto');
const TTL_MS = 10 * 60e3;
const _codes = new Map();   // code -> {page, focus, by: {id, orgId}, name, until}

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
// A code a person can type from a TV remote: no 0/O or 1/I/L.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(8), b => ALPHABET[b % ALPHABET.length]).join('');

function sweep() { const now = Date.now(); for (const [c, l] of _codes) if (l.until < now) _codes.delete(c); }

/** A link for `page` (one of cast/views.js), as the person asking: {code, path, until}. */
function create({ page, focus = null, name = null, thing = null }, who) {
  const views = require('./views').VIEWS;
  if (!views[page]) throw bad(`A screen can be given ${Object.keys(views).join(', ')}.`);
  if (!who?.user?.id) throw bad('Sign in first.', 401);
  sweep();
  const code = newCode();
  _codes.set(code, { page, focus: focus ? String(focus).slice(0, 120) : null, by: { id: who.user.id, orgId: who.orgId || null },
    name: name ? String(name).slice(0, 60) : null, thing: thing ? String(thing) : null, until: Date.now() + TTL_MS });
  return { code, path: `/api/cast/open/${code}`, until: new Date(Date.now() + TTL_MS).toISOString(), page };
}

/**
 * Opening a link: once only. Makes the screen and its view session, and answers where to go and the cookies to set.
 * @returns {{ location: string, cookies: string[], screen: object }}
 */
function open(code, req) {
  sweep();
  const l = _codes.get(String(code || '').toUpperCase());
  if (!l) throw bad('This link is used or has expired: make a new one on the screen that cast it.', 410);
  _codes.delete(String(code).toUpperCase());
  const authStore = require('../auth/store'), credentials = require('../auth/credentials'), devices = require('../api-v1/devices');
  const user = authStore.userById(l.by.id);
  if (!user || user.suspendedAt) throw bad('The person who cast this can no longer sign in.', 410);
  const views = require('./views').VIEWS;
  // A TV or a speaker Nearby saved has one screen record: the one its last cast made is signed out and goes, so the
  // Devices list does not fill with "Living room — Live" (2026-10-13).
  if (l.thing) forgetThing(l.thing);
  const made = devices.create({ name: l.name || `Showing ${views[l.page].label}`, kind: 'browser', scopes: [],
    caps: { formFactor: 'browser', input: { touch: false, text: false } } });
  devices.update(made.device.id, { userId: user.id, orgId: l.by.orgId, cast: { page: l.page, focus: l.focus, view: true, keep: false, ...(l.thing ? { thing: l.thing } : {}), at: new Date().toISOString() } });
  const token = credentials.startSession({ user, orgId: l.by.orgId, req, cap: [`view:${l.page}`] });
  authStore.updateSession(credentials.sha256(token), { screen: made.device.id, stepUpAt: null });
  require('../activity').note({ from: 'cast', what: `a screen opened a view link: ${views[l.page].label}`, why: 'a person cast it', person: { id: user.id, name: user.name || user.email },
    machine: { kind: 'screen', id: made.device.id, name: l.name || views[l.page].label }, act: 'cast' });
  const secure = req.secure || req.socket?.encrypted === true;
  const screens = require('../screens');
  return {
    // `cast=1`: the page locks itself at once, before it has asked who it is (solo.js); the hub refuses the rest anyway.
    location: l.page === 'face' ? '/face' : `/?view=${l.page}&cast=1${l.focus ? `#${encodeURIComponent(l.focus)}` : ''}`,
    cookies: [credentials.cookieHeader(token, { secure }), `${screens.COOKIE}=${made.device.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${400 * 86400}${secure ? '; Secure' : ''}`],
    screen: devices.get(made.device.id),
  };
}

/** The screen records a thing's casts made: signed out and gone. → how many. */
function forgetThing(thing) {
  const devices = require('../api-v1/devices');
  const old = devices.list().filter(d => d.kind === 'browser' && d.cast?.thing === thing);
  for (const d of old) devices.forget(d.id);
  return old.length;
}

module.exports = { create, open, forgetThing, TTL_MS, _codes };
