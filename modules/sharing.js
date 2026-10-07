'use strict';

/**
 * Offering what this hive learned to the project (CONSTITUTION §0, step 4; TODO P0.3). Only when its owner allows it:
 * `sharing.contribute` is asked once at installation (scripts/install.*) and stays a setting here — never proposable,
 * so no agent shares on its own behalf. When it is on, the skills, recipes and specialists the agents kept as packs
 * (the library's `agent` packs) are offered in Settings → Packs; one click by the owner sends one to the project's
 * hub (`sharing.upstream`, one of the hubs this hive sends packs to) through the hub-to-hub route — secrets already
 * stripped, as every pack is. Nothing leaves without that click.
 */
const { loadPrefs, savePrefs } = require('./utils');
const store = require('./store');

const SENT = 'sharing/sent';
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

/** The owner's answer: undecided until asked (`decided` false), then on or off, and where it goes. */
function state() {
  const s = loadPrefs().sharing || {};
  return { decided: typeof s.contribute === 'boolean', contribute: s.contribute === true, upstream: String(s.upstream || '') };
}

function set({ contribute, upstream } = {}) {
  const prefs = loadPrefs(), cur = prefs.sharing || {};
  const next = { ...cur };
  if (contribute !== undefined) next.contribute = contribute === true;
  if (upstream !== undefined) {
    const id = String(upstream || '');
    if (id && !require('./packs/send').list().some(h => h.id === id && h.send))
      throw bad('That is not a hub this hive sends packs to: add it under "Other hubs to send to" first.');
    next.upstream = id;
  }
  savePrefs({ ...prefs, sharing: next });
  return view();
}

/** What may be offered: the packs the agents kept (a person's own packs are theirs to send by hand), and what was sent. */
function view() {
  const sent = store.readJson(SENT, {});
  const candidates = require('./packs/library').list().filter(p => p.origin === 'agent')
    .map(p => ({ id: p.id, name: p.name, contents: p.contents, savedAt: p.savedAt, sentAt: sent[p.id] || null }));
  return { ...state(), hubs: require('./packs/send').list().filter(h => h.send).map(h => ({ id: h.id, label: h.label })), candidates };
}

async function share(packId) {
  const s = state();
  if (!s.contribute) throw bad('Sharing with the project is off: the owner switches it on in Settings → Packs.', 409);
  if (!s.upstream) throw bad('No project hub is chosen: pick one in Settings → Packs → Share with the project.', 409);
  let meta = null;
  try { meta = require('./packs/library').get(packId).meta; } catch { /* not in the library */ }
  if (meta?.origin !== 'agent') throw bad('Only a pack the agents kept here is offered to the project.', 404);
  const out = await require('./packs/send').send(s.upstream, packId);
  store.writeJson(SENT, { ...store.readJson(SENT, {}), [packId]: new Date().toISOString() });
  return { ok: true, sent: packId, to: s.upstream, ...(out && typeof out === 'object' ? { answer: out } : {}) };
}

function mount(app) {
  const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/api/sharing', h(() => view()));
  app.post('/api/sharing', h(req => set(req.body || {})));
  app.post('/api/sharing/:packId/share', h(req => share(req.params.packId)));
}

module.exports = { state, set, view, share, mount };
