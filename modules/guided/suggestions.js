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
 */
const store = require('../store');

const DOC = 'guided/suggestions';
const SHIPPED = require('./suggested-models.json');

/** A list worth keeping: a version, models with a role, an install and needs. Anything else is refused whole. */
function valid(doc) {
  if (!doc || typeof doc !== 'object' || !Number.isInteger(doc.version) || !Array.isArray(doc.models) || !doc.models.length) return false;
  return doc.models.every(m => m && typeof m.role === 'string' && typeof m.id === 'string'
    && m.install && typeof m.install.kind === 'string' && typeof m.install.id === 'string'
    && m.needs && Number.isFinite(m.needs.vramGB) && Number.isFinite(m.needs.ramGB));
}

/** The newest list this hive has: a received one when it is newer than the shipped one. */
function load() {
  const got = store.readJson(DOC, null);
  if (valid(got) && got.version > SHIPPED.version) return { ...SHIPPED, ...got, hosted: { ...SHIPPED.hosted, ...got.hosted }, keyPages: { ...SHIPPED.keyPages, ...got.keyPages } };
  return SHIPPED;
}

function about() {
  const d = load();
  return { version: d.version, updated: d.updated, source: d.source, received: d !== SHIPPED };
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

module.exports = { load, about, refresh, valid, SHIPPED };
