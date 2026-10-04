'use strict';

/**
 * This screen (TODO H2.2–H2.3): `GET /api/screen` is this browser's device and its effective settings, `POST
 * /api/screen/settings` changes them for this browser only — any signed-in person, for their own screen: it is
 * how their screen looks, not how the hive behaves. `GET /api/v1/settings/effective` is the same answer for a
 * paired client (its device's layer over the hive's).
 */
const screens = require('./index');

function mount(app) {
  app.get('/api/screen', (req, res) => {
    try {
      const d = screens.ensure(req, res);
      res.json({ id: d.id, name: d.name, ...screens.effective(d.id, req.auth.user.id), keys: screens.screenKeys() });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/screen/settings', (req, res) => {
    try {
      const d = screens.ensure(req, res);
      screens.set(d.id, req.body || {});
      res.json({ id: d.id, ...screens.effective(d.id, req.auth.user.id) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { mount };
