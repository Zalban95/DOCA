'use strict';

/** GET /api/admin/overview[?fresh=1] — Hub → Admin's five cards (index.js). A host's: rights.js. */
function mount(app) {
  app.get('/api/admin/overview', async (req, res) => {
    try { res.json(await require('./index').overview({ fresh: req.query.fresh === '1' })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { mount };
