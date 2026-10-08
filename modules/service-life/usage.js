'use strict';

/**
 * When each service was last used, and by whom it is the hub's to manage. Every request the hub sends to a service on
 * this machine — speech, a transcription, a model call whose provider address is a service's port (harness/inflight.js
 * calls `begin`) — marks it, by port: a map lookup and two numbers, cheap enough for every request. In memory, saved
 * every SAVE_MS when something changed (and when DOCA stops), so a restart does not make every service look unused.
 *
 * Per key (`<kind>:<id>`, targets.js), in the store document `service-life`:
 *   lastUsedAt     the last request's start or end
 *   startedAt      when DOCA last started it (a person's click, a device, an agent, or on demand)
 *   startedByDoca  DOCA has started it at least once — "Start when needed" is on by default for those
 *   firstSeenAt    when the hub first saw it running: an idle clock's start for a service nobody has used since
 *   adopted        { at, by } — a person let DOCA manage one started outside it
 */
const SAVE_MS = 60000;
const DOC = 'service-life';
let _state = null, _dirty = false, _timer = null;
const _flying = new Map();   // key → requests in flight now

function state() {
  if (!_state) { try { _state = require('../store').readJson(DOC, {}) || {}; } catch { _state = {}; } }
  return _state;
}
function row(key) { const s = state(); return (s[key] ||= {}); }
function set(key, fields) { Object.assign(row(key), fields); _dirty = true; }

const keyOfUrl = url => {
  const port = require('../machines/use-ports').portOf(url);
  return port ? require('./targets').byPort(port)?.key || null : null;
};

/** A request to `url` begins; returns the function that ends it. Not a service of this machine: a no-op. */
function begin(url) {
  let key = null;
  try { key = keyOfUrl(url); } catch { /* not ours */ }
  if (!key) return () => {};
  set(key, { lastUsedAt: Date.now() });
  _flying.set(key, (_flying.get(key) || 0) + 1);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    _flying.set(key, Math.max(0, (_flying.get(key) || 1) - 1));
    set(key, { lastUsedAt: Date.now() });
  };
}

/** A whole request at once (a fetch the caller awaits): mark, run, mark. */
async function around(url, fn) {
  const end = begin(url);
  try { return await fn(); } finally { end(); }
}

const flying = key => _flying.get(key) || 0;

/** DOCA started it (services.js and models-llamacpp.js after a start that answered). */
function started(key) { const now = Date.now(); set(key, { startedAt: now, startedByDoca: true, firstSeenAt: now }); }

/** Seen running: the idle clock of a service nobody has used starts here. */
function seen(key) { if (!row(key).firstSeenAt) set(key, { firstSeenAt: Date.now() }); }
/** Seen stopped: the next time it runs is a new run. */
function gone(key) { if (row(key).firstSeenAt) set(key, { firstSeenAt: null }); }

function adopt(key, on, by = null) { set(key, { adopted: on ? { at: Date.now(), by: by?.name || null } : null }); }

function save() {
  if (!_dirty) return;
  _dirty = false;
  try { require('../store').writeJson(DOC, state()); } catch { _dirty = true; }
}

function start() {
  if (_timer) return;
  _timer = setInterval(save, SAVE_MS);
  _timer.unref?.();
}

module.exports = { begin, around, flying, started, seen, gone, adopt, row: key => ({ ...row(key) }), save, start, keyOfUrl,
  _reset: () => { _state = {}; _flying.clear(); _dirty = false; } };
