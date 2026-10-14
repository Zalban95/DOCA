'use strict';

/**
 * A remote for a cast screen (asked 2026-10-14: "when casting let's have a toggle for easy nav with the basic controls of
 * a tv remote"). A TV showing a page has no keyboard and its own remote rarely reaches the page, so the person's phone —
 * or any screen of theirs — presses the keys: up, down, left, right, OK and Back go to that screen's own pages on the
 * live feed (topic `screen`, heard only by the screen it is for), which move a focus outline and press what it is on
 * (public/js/cast-remote.js). Nothing new is allowed by it: the page still reads only what its view allows.
 */
const KEYS = ['up', 'down', 'left', 'right', 'ok', 'back'];
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const isHost = who => require('../auth/rights').can(who?.role, 'host');

/** The screen records a press goes to: a saved TV's (what its casts made), or one screen of the person's. */
function screensFor(who, { thing = null, screen = null }) {
  const devices = require('../api-v1/devices');
  const live = d => d && d.kind === 'browser' && !d.revokedAt && !d.archivedAt;
  if (thing) {
    require('./things').thing(who, String(thing));   // allotted to this person, else refused there
    return devices.list().filter(d => live(d) && d.cast?.thing === String(thing)).map(d => d.id);
  }
  const d = devices.get(String(screen || ''));
  if (!live(d)) throw bad('Not a screen of this hive.', 404);
  if (!isHost(who) && d.userId !== who.user.id) throw bad('Not a screen of yours.', 404);
  return [d.id];
}

function press(who, { thing = null, screen = null, key }) {
  if (!KEYS.includes(key)) throw bad(`A key is one of ${KEYS.join(', ')}.`);
  const ids = screensFor(who, { thing, screen });
  if (!ids.length) throw bad('Nothing is cast there now: cast a page first.', 409);
  for (const id of ids) require('../live').changed('screen', id, 'key', { key });
  return { ok: true, sent: ids.length };
}

module.exports = { KEYS, press, screensFor };
