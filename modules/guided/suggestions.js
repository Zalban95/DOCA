'use strict';

/**
 * The models the project suggests, per role, with what each needs (suggested-models.json, shipped and versioned).
 *
 * The list is data, not code, so it can be replaced without a release: a newer one received from the project's hub
 * is kept in the store (`guided/suggestions`) and wins while its version is higher than the shipped one. Receiving
 * one is the other half of sharing (sharing.js, CONSTITUTION §0 step 4): only a hive whose owner shares with the
 * project, and has chosen the project's hub, asks for it — `refresh({ fetch })` checks both before anything leaves.
 * The transport is passed in: the project hub's route for it does not exist yet, so nothing here reaches the network
 * by itself, and a test drives it with a stub.
 *
 * Over whichever list is in use lies this install's own overlay (overlay.js): entries a person accepted from the model
 * scout. And every list is read the same way (`expand`): an entry's `alsoFor` roles become entries of their own, and a
 * field an older list lacks reads as its default (rank 0, no sources), so a version-1 list still loads.
 * docs/design/model-suggestions.md says where the entries come from and who decides.
 */
const store = require('../store');
const overlay = require('./overlay');

const DOC = 'guided/suggestions';
const SHIPPED = require('./suggested-models.json');

/** A list worth keeping: a version, models with a role, an install and needs. Anything else is refused whole. */
function valid(doc) {
  if (!doc || typeof doc !== 'object' || !Number.isInteger(doc.version) || !Array.isArray(doc.models) || !doc.models.length) return false;
  return doc.models.every(m => m && typeof m.role === 'string' && typeof m.id === 'string'
    && m.install && typeof m.install.kind === 'string' && typeof m.install.id === 'string'
    && m.needs && Number.isFinite(m.needs.vramGB) && Number.isFinite(m.needs.ramGB));
}

/** One entry per role: `alsoFor` read out, and the read-side defaults of fields older lists do not have. */
function expand(models) {
  return models.flatMap(m => [m, ...(Array.isArray(m.alsoFor) ? m.alsoFor : []).map(role => ({ ...m, role, alsoOf: m.role }))])
    .map(({ alsoFor, ...m }) => ({ rank: 0, sources: [], ...m }));
}

/** The list in use before the overlay: a received one when it is newer than the shipped one. */
function base() {
  const got = store.readJson(DOC, null);
  if (valid(got) && got.version > SHIPPED.version) return { ...SHIPPED, ...got, hosted: { ...SHIPPED.hosted, ...got.hosted }, keyPages: { ...SHIPPED.keyPages, ...got.keyPages }, received: true };
  return { ...SHIPPED, received: false };
}

/** The list this hive picks from: the newest list, with what a person accepted here laid over it. */
function load() {
  const b = base(), local = expand(overlay.list().map(e => ({ ...e, local: true })));
  const key = m => `${m.role}\u0000${m.id}`;
  const mine = new Set(local.map(key));
  const checked = [b.checked || b.updated, overlay.checked()].filter(Boolean).sort().pop() || null;
  return { ...b, checked, models: [...expand(b.models).filter(m => !mine.has(key(m))), ...local], localCount: overlay.list().length };
}

/** What Set-up says about the list: which, from where, and the day it was last checked. */
function about() {
  const d = load();
  return { version: d.version, updated: d.updated, checked: d.checked, source: d.source, received: d.received, local: d.localCount };
}

/**
 * Ask the project's hub for a newer list. `fetch(upstreamHubId)` returns the document (or throws); it is only called
 * when the owner shares with the project and has picked its hub. Returns what happened, in words.
 */
async function refresh({ fetch } = {}) {
  const s = require('../sharing').state();
  if (!s.contribute) return { ok: false, reason: 'Sharing with the project is off, so this hive does not ask it for suggestions (Settings → Packs).' };
  if (!s.upstream) return { ok: false, reason: 'No project hub is chosen (Settings → Packs → Share with the project).' };
  if (typeof fetch !== 'function') return { ok: false, reason: 'The project hub does not offer suggestions yet.' };
  let doc;
  try { doc = await fetch(s.upstream); } catch (e) { return { ok: false, reason: `The project hub did not answer: ${e.message}` }; }
  if (!valid(doc)) return { ok: false, reason: 'What the project hub sent is not a suggestions list; kept the one here.' };
  if (doc.version <= load().version) return { ok: true, kept: true, version: load().version };
  store.writeJson(DOC, { ...doc, receivedAt: new Date().toISOString(), from: s.upstream });
  return { ok: true, version: doc.version };
}

module.exports = { load, base, about, refresh, valid, expand, SHIPPED };
