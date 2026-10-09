'use strict';

/**
 * A browser is a device (docs/design/hive.md §1; TODO H2.2–H2.3). The first time a signed-in browser asks,
 * it gets a device record of kind `browser` (no scopes, no usable token — it reaches the hub by its sign-in
 * session, which this binds to it as `screen`), so it is listed with the phones and watches and revoking it
 * signs that browser out (credentials.resolveHash). A cookie remembers which record is this browser, so
 * signing in again keeps its settings.
 *
 * Settings layer: the hive's (prefs) → the person's → this device's, for the keys settings-schema.js gives
 * home `device`, `on: 'screen'` (theme, tabs, sidebar…). An install's existing prefs stay the default every
 * screen starts from; a change made on a screen is that screen's. Nothing to migrate.
 */
const store = require('../store');

const COOKIE = 'doca_screen';
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

const screenKeys = () => Object.entries(require('../settings-schema').SCHEMA).filter(([, d]) => d.home === 'device' && d.on === 'screen').map(([k]) => k);
const layerDoc = id => `device-settings/${id}`;
const layer = id => store.readJson(layerDoc(id), { settings: {} }).settings || {};
const personDoc = userId => `person-settings/${userId}`;
const personLayer = userId => (userId ? store.readJson(personDoc(userId), { settings: {} }).settings || {} : {});

/** "Chrome on Linux", "Safari on iPhone": a name a person recognises in a list. */
function nameOf(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const o = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'a device';
  return `${b} on ${o}`;
}

const cookieOf = req => (/(?:^|;\s*)doca_screen=([\w-]+)/.exec(req.headers.cookie || '') || [])[1] || null;
const valid = (d, userId) => d && d.kind === 'browser' && !d.revokedAt && d.userId === userId;

/**
 * The device whose screen this is. On a device's own page (/d/<id>/, TODO H2.4) it is that device — opened
 * by its own token, or by the person who owns it — so a phone's look is what its app reads back from
 * /api/v1/settings/effective. Anywhere else it is this browser's record, made the first time and bound to
 * the sign-in session.
 */
function ensure(req, res, deviceId = null) {
  const devices = require('../api-v1/devices');
  const who = req.auth;
  if (!who?.user?.id) throw bad('Sign in first.', 401);
  const own = id => { const x = id && devices.get(id); return x && !x.revokedAt && (who.session?.deviceId === x.id || x.userId === who.user.id) ? x : null; };
  if (who.session?.deviceId) return own(who.session.deviceId) || (() => { throw bad('This device is not paired any more.', 401); })();
  if (deviceId) return own(deviceId) || (() => { throw bad('Not a device of yours.', 404); })();
  let d = who.session?.screen ? devices.get(who.session.screen) : null;
  if (!valid(d, who.user.id)) d = cookieOf(req) ? devices.get(cookieOf(req)) : null;
  if (!valid(d, who.user.id)) {
    const ua = String(req.get('user-agent') || '');
    const made = devices.create({ name: nameOf(ua), kind: 'browser', scopes: [], caps: { formFactor: 'browser', input: { touch: /Mobile|Android|iPhone|iPad/.test(ua), text: true } } });
    devices.update(made.device.id, { userId: who.user.id, orgId: who.orgId || null });
    d = devices.get(made.device.id);
  }
  if (who.session?.hash && who.session.screen !== d.id) require('../auth/store').updateSession(who.session.hash, { screen: d.id });
  res?.setHeader?.('Set-Cookie', `${COOKIE}=${d.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${400 * 86400}${req.secure || req.socket?.encrypted ? '; Secure' : ''}`);
  return d;
}

/** The effective screen settings for a device: hive → person → device, per declared screen key. */
function effective(deviceId, userId, prefs = require('../utils').loadPrefs()) {
  const mine = layer(deviceId), person = personLayer(userId);
  const out = {}, from = {};
  for (const k of screenKeys()) {
    if (mine[k] !== undefined) { out[k] = mine[k]; from[k] = 'device'; }
    else if (person[k] !== undefined) { out[k] = person[k]; from[k] = 'person'; }
    else if (prefs[k] !== undefined) { out[k] = prefs[k]; from[k] = 'hive'; }
  }
  // The panel's structure is layered field by field, not replaced whole: a screen that only enlarges its text keeps
  // the groups and views its person made (panel-layout/layout.js).
  if (out.panel !== undefined) out.panel = require('../panel-layout/layout').merge([prefs.panel, person.panel, mine.panel]);
  return { settings: out, from };
}

/** The settings of the screen a request comes from (its browser device, or the device whose token opened the session). */
function forRequest(req) {
  const id = req.auth?.session?.screen || req.auth?.session?.deviceId;
  return id && req.auth?.user ? effective(id, req.auth.user.id).settings : {};
}

/** The voice the screen a request comes from chose (`voice`: ttsVoice, ttsSpeed), or {} for the hive's. */
function voiceOf(req) { try { return forRequest(req).voice || {}; } catch { return {}; } }

function write(doc, cur, patch) {
  const keys = screenKeys();
  const unknown = Object.keys(patch).filter(k => !keys.includes(k));
  if (unknown.length) throw bad(`Not a setting a screen keeps: ${unknown.join(', ')}. A screen keeps: ${keys.join(', ')}.`);
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete cur[k]; else cur[k] = v; }
  const size = JSON.stringify(cur).length;
  if (size > 200000) throw bad('That is more than a screen keeps (200 KB).', 413);
  store.writeJson(doc, { settings: cur, updatedAt: new Date().toISOString() });
  return cur;
}

/** Change this device's layer: a value sets it, null puts it back to the hive's (or the person's). */
function set(deviceId, patch = {}) {
  const out = write(layerDoc(deviceId), layer(deviceId), patch);
  require('../look/routes').announce('device', deviceId, Object.keys(patch));   // the device's app reads its look again
  return out;
}

/** Change a person's layer — theirs on every device of theirs (CONSTITUTION S13): null puts a key back to the hive's. */
function setPerson(userId, patch = {}) {
  if (!userId) throw bad('Sign in first.', 401);
  const out = write(personDoc(userId), personLayer(userId), patch);
  require('../look/routes').announce('person', userId, Object.keys(patch));
  return out;
}

module.exports = { forRequest, voiceOf, ensure, effective, set, setPerson, layer, personLayer, screenKeys, nameOf, COOKIE };
