'use strict';

/**
 * Important changes, said where the person is (asked 2026-10-16: "whenever we do something of this high level, the
 * chat shows a red line with what changed, mechanically, and if we are in a call the dots get red… Everything
 * logged."). "High level" is what auth/guarded.js asks about — the password and notice switches, settings paths and
 * routes alike — plus accounts, levels and grants through their routes (guarded.js names them too).
 *
 * One middleware after the gate: a request that flips a switch reached here only because its guard passed. What it
 * changes is read before the handler runs and after it answered (words.js, people.js) and, when it changed something,
 * becomes one record:
 *   - a line in the activity log with `important: true` (activity.js; Chronicle's `hub` source, state "important")
 *     and a row in the audit trail (auth/store.js `important change`);
 *   - a red row in the person's own main conversation (the floating chat) and in the conversation that proposed it,
 *     role `note` — DOCA's own note, drawn by the chats and never sent to a model (turn/messages.js leaves it out);
 *   - the live feed's `important` topic, heard by that person's pages and a host's (live/routes.js): an open console
 *     on another conversation draws the line too, and a call open on that screen turns the face's points red for a
 *     moment and says it on its status line (public/js/important.js);
 *   - a device's call of theirs gets the same text as a `notice` frame, stage `important` (realtime/calls.js).
 * Mechanical: fixed words filled with names and values; no model and no agent writes any of it.
 */
const words = require('./words');
const people = require('./people');

const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EAGER = new Set(['restart', 'version']);   // the hub may be gone before the answer: said when the guard passed
const SETTING_ROUTES = /^\/api\/(prefs|harness\/proposals\/[^/]+\/apply)$/;   // nothing changed, nothing said
const MAX_LINES = 6;

const clone = v => JSON.parse(JSON.stringify(v ?? {}));

/** How the change came: a proposal accepted, a checkpoint restored, or the panel. */
function howOf(req) {
  if (/^\/api\/harness\/proposals\/[^/]+\/apply$/.test(req.path)) return 'a proposal accepted';
  if (/^\/api\/settings\/checkpoints\/[^/]+\/restore$/.test(req.path)) return 'a checkpoint restored';
  return 'the panel';
}

function proposalSession(req) {
  const m = /^\/api\/harness\/proposals\/([^/]+)\/apply$/.exec(req.path);
  if (!m) return null;
  try { return require('../harness/settings').find(m[1])?.sessionId || null; } catch { return null; }
}

/** The words of the change: settings first, then accounts and levels, then the route's own. */
function linesOf(req, sw, b, answer) {
  const paths = require('../auth/guarded').PREFS.map(([p]) => p);
  let out = [];
  try { out = words.prefsLines(b.prefs, require('../utils').loadPrefs(), paths); } catch { /* no prefs file */ }
  if (out.length) return out;
  if (SETTING_ROUTES.test(req.path)) return [];
  try { const p = people.lines(req, b.people, answer); if (p?.length) return p; } catch { /* records gone */ }
  return [words.routeLine(sw, req)];
}

/** One important change, written everywhere it is said. Returns the record. */
function record({ sw, lines, person, via, how, sessionId = null, orgId = null }) {
  if (!lines?.length) return null;
  const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `and ${lines.length - MAX_LINES} more`] : lines;
  const text = `⚠ Changed: ${shown.join('; ')}`;
  const who = person?.id ? { id: person.id, name: person.name || person.email || person.id } : null;
  const at = new Date().toISOString();
  require('../activity').note({ from: 'person', what: shown.join('; '), why: `${how}${via ? ` from ${via}` : ''}`, person: who,
    level: 'warn', sessionId, important: true, lines });
  try { require('../auth/store').audit({ orgId, actorId: person?.id || null, action: 'important change', detail: text, switch: sw.what, how, via }); } catch { /* the audit never breaks the change */ }
  const stored = storeRows({ text, lines, sw, how, via, person, sessionId, at });
  require('../live').changed('important', sw.key, 'changed', { personId: person?.id || null, text, lines, stored, how, via });
  try { require('../realtime/calls').important(person?.id || null, text); } catch { /* no calls */ }
  return { text, lines, stored, at };
}

/** The red row in the person's own main conversation and the one that proposed it; the conversations it landed in. */
function storeRows({ text, lines, sw, how, via, person, sessionId, at }) {
  const memory = require('../harness/memory');
  const ids = new Set();
  try {
    const main = person?.id ? require('../harness/own-main').of(person, { create: false }) : null;
    if (main) ids.add(main);
  } catch { /* no harness yet */ }
  if (sessionId && memory.getSession(sessionId)) ids.add(sessionId);
  const product = require('../branding').name('product');
  for (const id of ids) {
    try {
      memory.append(id, { role: 'note', content: text, at, from: { id: null, name: product, formFactor: 'hub' },
        important: { switch: sw.key, lines, how, via, by: person?.id || null } });
      require('../live').changed('conversation', id, 'row');
    } catch { ids.delete(id); }
  }
  return [...ids];
}

/** The middleware, after the gate: a switch flipped by a signed-in person, said once it changed something. */
function middleware(req, res, next) {
  if (!CHANGES.has(req.method) || !req.auth?.user) return next();
  let sw = null;
  try { sw = require('../auth/guarded').switchOf(req); } catch { sw = null; }
  if (!sw) return next();
  const person = require('../harness/turn/client').personOf(req.auth);   // id, name, email, role — never the account's hash
  let via = 'the panel';
  try { via = require('../machines/acts').viaOf(req); } catch { /* no registry */ }
  const ctx = { sw, person, via, how: howOf(req), sessionId: proposalSession(req), orgId: req.auth.orgId || null };
  if (EAGER.has(sw.key)) { try { record({ ...ctx, lines: [words.routeLine(sw, req)] }); } catch { /* never in the way */ } return next(); }
  const b = {};
  try { b.prefs = clone(require('../utils').loadPrefs()); } catch { b.prefs = {}; }
  try { b.people = people.before(req); } catch { b.people = null; }
  let answer = null;
  const json = res.json.bind(res);
  res.json = body => { answer = body; return json(body); };
  res.on('finish', () => {
    if (res.statusCode >= 400 || answer?.error || answer?.ok === false) return;
    try { record({ ...ctx, lines: linesOf(req, sw, b, answer) }); } catch (e) { console.warn(`[important] not recorded: ${e.message}`); }
  });
  next();
}

module.exports = { middleware, record, linesOf, MAX_LINES };
