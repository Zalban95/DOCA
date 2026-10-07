'use strict';

/**
 * How often each path is used (TODO H10.7, CONSTITUTION W14): a counter per key — `tool:<name>` for every tool call by
 * the name it was called with, `search:<provider>`, `vision:<reader>`, `oneshot:<adapter>`, `chat:builtin` — so an
 * alternative kept beside its replacement can be seen to be unused. Names and numbers only, never what was asked.
 *
 * Counted in memory and written to DATA_DIR/features/usage.json a few seconds later (and at exit): a count is a
 * hint for the admin, not a record, so losing the last seconds before a crash costs nothing. Days are kept for the
 * last DAYS days, which is what "used N times since" is read from.
 */
const store = require('../store');

const DOC = 'features/usage';
const DAYS = 120;
let doc = null, timer = null;

const day = (t = new Date()) => t.toISOString().slice(0, 10);

function load() {
  if (!doc) {
    doc = store.readJson(DOC, null) || {};
    if (!doc.since) doc.since = new Date().toISOString();   // counting began: "never used" means "not since then"
    if (!doc.keys) doc.keys = {};
  }
  return doc;
}

function flush() {
  clearTimeout(timer); timer = null;
  if (doc) try { store.writeJson(DOC, doc); } catch { /* a counter never breaks the thing it counts */ }
}

/** One use of `key`. Cheap: an increment, and a write some seconds later. */
function count(key) {
  try {
    const d = load(), now = new Date(), k = d.keys[key] || (d.keys[key] = { n: 0, first: now.toISOString(), last: null, days: {} });
    k.n += 1; k.last = now.toISOString();
    k.days[day(now)] = (k.days[day(now)] || 0) + 1;
    const cut = day(new Date(now - DAYS * 86400000));
    for (const dd of Object.keys(k.days)) if (dd < cut) delete k.days[dd];
    if (!timer) { timer = setTimeout(flush, 5000); timer.unref?.(); }
  } catch { /* as above */ }
}

/** `{n, first, last}` for a key (zeros when never used). */
function of(key) {
  const k = load().keys[key];
  return k ? { n: k.n, first: k.first, last: k.last } : { n: 0, first: null, last: null };
}

/** Uses of `key` on or after `iso`'s day (within the last DAYS days). */
function since(key, iso) {
  const k = load().keys[key];
  if (!k) return 0;
  const from = iso ? day(new Date(iso)) : '';
  return Object.entries(k.days).filter(([d]) => d >= from).reduce((s, [, n]) => s + n, 0);
}

const began = () => load().since;

/** For a test: forget what is in memory so the file is read again. */
function reset() { clearTimeout(timer); timer = null; doc = null; }

process.on('exit', flush);

module.exports = { count, of, since, began, flush, reset, DAYS };
