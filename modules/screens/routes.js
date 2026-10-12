'use strict';

/**
 * This screen (TODO H2.2–H2.3): `GET /api/screen` is this browser's device and its effective settings, `POST
 * /api/screen/settings` changes them for this browser only — any signed-in person, for their own screen: it is
 * how their screen looks, not how the hive behaves. `GET /api/v1/settings/effective` is the same answer for a
 * paired client (its device's layer over the hive's).
 */
const screens = require('./index');

function mount(app) {
  require('../panel-layout/routes').mount(app);   // the panel's structure as data, per person and per screen (TODO P1.2)
  // The speech service's voices, for a screen to pick its own from (Settings → Voice → This screen's voice).
  app.get('/api/chat/voices', require('../chat').handleVoices);
  // Which voice services run and what uses each (Settings → Voice's card), and what a typed setting could be — the
  // addresses and models found on this machine (lib/choice-input.js). Both under /api/services, so an admin's.
  require('../voice-services').mount(app);
  require('../service-choices').mount(app);
  // A spoken answer the person talked over: the floating chat's conversation keeps only what was heard (harness/heard.js).
  app.post('/api/chat/heard', (req, res) => {
    const mine = require('../harness/own-main').of(require('../harness/turn/client').dashboardClient(req).user, { create: false });   // the person's own Orchestrator
    const row = mine ? require('../harness/heard').cut(mine, req.body?.heard) : null;
    res.json({ cut: !!row, ...(row ? { content: row.content } : {}) });
  });
  app.get('/api/screen', (req, res) => {
    try {
      const d = screens.ensure(req, res, req.query.device || null);
      // The switches that change how a call behaves on a screen: any person's screen needs them, not only the owner's.
      const ex = require('../experiments');
      const eff = screens.effective(d.id, req.auth.user.id);
      res.json({ id: d.id, name: d.name, kind: d.kind, ...eff, keys: screens.screenKeys(),
        panelMode: require('./panel-mode').resolve(d.id, req.auth.user, req.auth.role, eff),   // Focused or Extended, and from where
        experiments: { ...Object.fromEntries(['bargeIn', 'wakeWord', 'wakeModel'].map(id => [id, ex.on(id)])), faceVoice: true } });   // faceVoice graduated (3.41.0): on for every call
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  // A device's own notifications (its profile: questions, haptics, quiet hours), for its page — the device's
  // own session or its person. The rest of the profile (pages, commands) is the client's and is kept.
  app.get('/api/screen/profile', (req, res) => {
    try { const d = screens.ensure(req, res, req.query.device || null); res.json({ id: d.id, profile: require('../api-v1/profiles').get(d.id) }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/screen/profile', (req, res) => {
    try {
      const d = screens.ensure(req, res, req.query.device || null);
      if (d.kind === 'browser') throw Object.assign(new Error('A browser takes no questions of its own; its person\'s devices do.'), { status: 400 });
      const profiles = require('../api-v1/profiles');
      const cur = profiles.get(d.id);
      const { prompts, quietHours } = req.body || {};
      const stored = profiles.put(d.id, { ...cur, ...(prompts ? { prompts: { ...cur.prompts, ...prompts } } : {}), ...(quietHours !== undefined ? { quietHours } : {}) }, req.auth.user.id);
      const eff = profiles.effective(stored, d.scopes);
      require('../api-v1/bus').publish(d.id, 'profile.changed', { version: stored.version, etag: eff.etag, updatedBy: req.auth.user.id, url: '/api/v1/devices/me/profile' });
      res.json({ id: d.id, profile: stored });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/screen/settings', (req, res) => {
    try {
      const d = screens.ensure(req, res, req.query.device || null);
      const patch = req.body || {};
      if (patch.panelMode != null && !require('./panel-mode').valid(patch.panelMode))
        throw Object.assign(new Error(`panelMode is one of: ${require('./panel-mode').MODES.join(', ')}.`), { status: 400 });
      // ?layer=person: the person's own layer, theirs on every device (S13) — "on all my screens". Else this screen's.
      if (req.query.layer === 'person') screens.setPerson(req.auth.user.id, patch); else screens.set(d.id, patch);
      const eff = screens.effective(d.id, req.auth.user.id);
      res.json({ id: d.id, ...eff, panelMode: require('./panel-mode').resolve(d.id, req.auth.user, req.auth.role, eff) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { mount };
