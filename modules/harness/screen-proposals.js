'use strict';

/**
 * A settings proposal for one screen (audit 2026-10-06, coh F13; TODO C2). How a call listens, the voice a screen is
 * answered in, the ambient screen and the face are each screen's own (settings-schema.js `on: 'screen'`), so a proposal
 * the hive's prefs would apply to every screen at once — or, for these keys, to none, since a screen's own layer wins.
 * Here the agent names the screen (the one the person asked from, by default), the card says which, and Apply writes
 * that screen's layer through screens.set — never the prefs file. Only the keys marked `screenPropose` are proposable;
 * the same refusals as the hive's (secrets, prototype paths, shapes) hold through settings.refuse.
 */
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

const keys = () => require('../settings-schema').screenSettable();
const allowed = dotted => keys().includes(String(dotted).split('.')[0]);

/** The screen a proposal targets: a device record a person can see, with its effective settings. */
function target(id, person = null) {
  // A person's own layer (`person:<user id>`): theirs on every device (panel layout, TODO P1.2; CONSTITUTION S13).
  if (String(id || '').startsWith('person:')) {
    const userId = id.slice(7);
    if (!userId || (person?.id && userId !== person.id && !require('./session-access').isHost(person))) throw bad('That is someone else\'s.', 403);
    const prefs = require('../utils').loadPrefs(), own = require('../screens').personLayer(userId);
    const settings = Object.fromEntries(keys().map(k => [k, own[k] ?? prefs[k]]).filter(([, v]) => v !== undefined));
    if (settings.panel !== undefined) settings.panel = require('../panel-layout/layout').merge([prefs.panel, own.panel]);
    return { id, name: 'every device of theirs', layer: 'person', userId, settings };
  }
  if (id === 'this') throw bad('This turn did not come from a screen; name one from doca_clients.', 404);   // "this" with no screen behind it
  const d = id && require('../api-v1/devices').get(id);
  if (!d || d.revokedAt) throw bad(id ? `No screen ${id} — name one from doca_clients, or leave screen out for the hive's settings.` : 'This turn did not come from a screen; name one.', 404);
  if (person?.id && d.userId && d.userId !== person.id && !require('./session-access').isHost(person)) throw bad('That screen is someone else\'s.', 403);
  return { id: d.id, name: d.name || d.id, settings: require('../screens').effective(d.id, d.userId).settings };
}

/** Write an accepted proposal into its screen's layer: each top key as it is now on that screen, with the change made. */
function apply(p, person = null) {
  const t = target(p.screen?.id, person);
  const patch = {};
  for (const c of p.changes) {
    const [top, ...rest] = c.path.split('.');
    if (!rest.length) { patch[top] = c.to; continue; }
    const base = patch[top] ?? structuredClone(t.settings[top] ?? {});
    let o = base;
    for (const k of rest.slice(0, -1)) o = (o[k] && typeof o[k] === 'object') ? o[k] : (o[k] = {});
    o[rest.at(-1)] = c.to;
    patch[top] = base;
  }
  // The layout goes through its own module, which keeps what it replaced for Undo and tells the screens showing it.
  if (patch.panel !== undefined) { require('../panel-layout').write(t.layer || 'screen', { userId: t.userId, deviceId: t.id }, patch.panel); delete patch.panel; }
  if (!Object.keys(patch).length) return t;
  if (t.layer === 'person') { require('../screens').setPerson(t.userId, patch); return t; }
  require('../screens').set(t.id, patch);
  require('../live').changed?.('screen', t.id, 'settings');
  return t;
}

/** The proposable keys as they are on the turn's screen, with their hints: `call.silenceMs = 2000   # How long…`. */
function readable(id, person = null) {
  let t; try { t = id ? target(id, person) : null; } catch { t = null; }
  if (!t) return [];
  const schema = require('../settings-schema').SCHEMA, out = [];
  for (const k of keys()) {
    const d = schema[k], now = t.settings[k];
    if (d.keys) for (const [leaf, l] of Object.entries(d.keys)) out.push(`${k}.${leaf} = ${JSON.stringify(now?.[leaf] ?? l.default)}${l.hint ? `   # ${l.hint}` : ''}`);
    else out.push(`${k} = ${JSON.stringify(now ?? null).slice(0, 300)}   # ${d.note}`);
  }
  return out;
}

/** How the turn's screen is named to the tool: the dashboard's browser record, else the device that asked. */
const screenOf = client => client?.screen || (client?.kind !== 'dashboard' ? client?.id : null) || null;

module.exports = { keys, allowed, target, apply, readable, screenOf };
