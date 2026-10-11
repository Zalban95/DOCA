'use strict';

/**
 * What Nearby keeps, through store.js (DATA_DIR/nearby/…), never prefs:
 *   nearby/seen    every thing seen by a scan, joined across scans (merge.into) — forgotten ones are dropped until seen again
 *   nearby/things  the things a person saved: a name of theirs, a place and a room (free text they make — Home → Living
 *                  room, Lab, Office), the keys that say which seen thing it is, and the last of what was seen of it
 * A saved thing survives every scan; its "last seen", addresses and abilities follow the seen thing it matches.
 */
const crypto = require('crypto');
const store = require('../store');
const { same } = require('./merge');

const SEEN = 'nearby/seen', THINGS = 'nearby/things';
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const text = (v, max = 60) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

const seen = () => store.readJson(SEEN, { things: [], lastScan: null }).things || [];
const lastScan = () => store.readJson(SEEN, {}).lastScan || null;
function writeSeen(things, scan) {
  const keep = things.sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen))).slice(0, 500);
  store.writeJson(SEEN, { things: keep, lastScan: scan || lastScan() });
}
function forget(id) {
  const all = seen();
  const t = all.find(x => x.id === id);
  if (!t) throw bad('Nothing by that id was seen.', 404);
  writeSeen(all.filter(x => x.id !== id));
  return { forgot: id, name: t.name };
}

const things = () => store.readJson(THINGS, { things: [] }).things || [];
const writeThings = list => store.writeJson(THINGS, { things: list });

/** The seen thing a saved one is (any key in common), for its last-seen facts. */
const seenOf = (saved, list = seen()) => list.find(s => same({ keys: saved.keys || [] }, s) || same(s, { keys: saved.keys || [] })) || null;

/** Saved things, each with what was last seen of it. */
function saved() {
  const list = seen();
  return things().map(t => {
    const s = seenOf(t, list);
    return { ...t, seenId: s?.id || null, lastSeen: s?.lastSeen || t.lastSeen || null, addresses: s?.addresses || t.addresses || [],
      can: s?.can || t.can || [], how: s?.how || t.how || {}, web: s?.web || t.web || null, sources: s?.sources || t.sources || [] };
  }).sort((a, b) => a.place.localeCompare(b.place) || a.room.localeCompare(b.room) || a.name.localeCompare(b.name));
}

/** Save a seen thing (by its id), or change a saved one (`id`): a name, a place and a room. */
function save({ id, seenId, name, place, room, kind } = {}) {
  const list = things();
  let t = id ? list.find(x => x.id === id) : null;
  if (id && !t) throw bad('No saved thing by that id.', 404);
  const from = !t ? seen().find(x => x.id === seenId) : null;
  if (!t && !from) throw bad('Scan first: that thing is no longer in the list of what was seen.', 404);
  if (from && list.some(x => seenOf(x, [from]))) throw bad(`"${from.name}" is already saved.`, 409);
  name = text(name ?? t?.name ?? from?.name) || from?.name || 'Unnamed';
  place = text(place ?? t?.place) || 'Unsorted';
  room = text(room ?? t?.room, 40);
  const fields = { name, place, room, kind: require('./merge').KINDS.includes(kind) ? kind : t?.kind || from?.kind || 'unknown' };
  if (t) Object.assign(t, fields, { changedAt: new Date().toISOString() });
  else {
    t = { id: `n_${crypto.randomBytes(5).toString('hex')}`, ...fields, keys: from.keys.filter(k => !k.startsWith('ip:')).concat(from.keys.filter(k => k.startsWith('ip:'))),
      addresses: from.addresses, can: from.can, how: from.how, web: from.web, sources: from.sources, maker: from.maker, model: from.model,
      lastSeen: from.lastSeen, savedAt: new Date().toISOString() };
    list.push(t);
  }
  writeThings(list);
  return saved().find(x => x.id === t.id);
}

function remove(id) {
  const list = things();
  const t = list.find(x => x.id === id);
  if (!t) throw bad('No saved thing by that id.', 404);
  writeThings(list.filter(x => x.id !== id));
  return { removed: id, thing: t };
}

/** Put a removed thing back as it was (the page's Undo). */
function restore(thing) {
  if (!thing?.id || !/^n_[0-9a-f]{10}$/.test(thing.id) || !Array.isArray(thing.keys)) throw bad('That is not a saved thing.');
  const list = things().filter(x => x.id !== thing.id);
  list.push({ ...thing, name: text(thing.name) || 'Unnamed', place: text(thing.place) || 'Unsorted', room: text(thing.room, 40) });
  writeThings(list);
  return { restored: thing.id };
}

/** The places and their rooms people made, for the save dialog's chips. */
function places() {
  const m = new Map();
  for (const t of things()) { if (!m.has(t.place)) m.set(t.place, new Set()); if (t.room) m.get(t.place).add(t.room); }
  return [...m].map(([name, rooms]) => ({ name, rooms: [...rooms].sort() })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Export: the saved things as they are kept. Import: each added unless one with its keys is saved already. */
const exportAll = () => ({ kind: 'doca-nearby', version: 1, things: things() });
function importAll(doc) {
  const incoming = Array.isArray(doc?.things) ? doc.things.slice(0, 500) : null;
  if (!incoming) throw bad('That is not a Nearby export (it has no "things").');
  const list = things();
  let added = 0;
  for (const x of incoming) {
    if (!Array.isArray(x?.keys) || !x.keys.length || list.some(t => same({ keys: x.keys.filter(k => typeof k === 'string') }, t))) continue;
    list.push({ id: `n_${crypto.randomBytes(5).toString('hex')}`, name: text(x.name) || 'Unnamed', place: text(x.place) || 'Unsorted', room: text(x.room, 40),
      kind: require('./merge').KINDS.includes(x.kind) ? x.kind : 'unknown', keys: x.keys.filter(k => typeof k === 'string').slice(0, 20),
      addresses: [], can: Array.isArray(x.can) ? x.can.filter(c => typeof c === 'string').slice(0, 20) : [], how: {}, savedAt: new Date().toISOString() });
    added++;
  }
  writeThings(list);
  return { added, skipped: incoming.length - added };
}

module.exports = { seen, lastScan, writeSeen, forget, saved, save, remove, restore, places, exportAll, importAll, seenOf };
