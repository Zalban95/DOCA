'use strict';

/**
 * /api/licence/computers — Settings → System → Licence → Licence for test computers (public/js/settings/licence-pool.js):
 * the licence whose seats the hub hands to DOCA installs inside agents' computers (pool.js). A host's, as every
 * /api/licence route is (auth/rights.js). The key goes in and never comes back out.
 *
 *   GET    /api/licence/computers                   whether one is set, its server, its seats and who holds them
 *   POST   /api/licence/computers                   {key?, server, account?, seats} — set or change it
 *   DELETE /api/licence/computers                   forget it, freeing every seat the server lets go
 *   DELETE /api/licence/computers/seats/:computer   give one computer's seat back now
 */
const pool = require('./pool');

const fail = (res, e) => res.status(e.pool ? e.status : 500).json({ error: e.message, code: e.code || 'error' });

function mount(app) {
  app.get('/api/licence/computers', (req, res) => res.json(pool.view()));
  app.post('/api/licence/computers', (req, res) => {
    try { res.json({ ok: true, said: 'Kept. The key stays on the hub; an agents\' computer gets a seat when an install in it asks.', pool: pool.set(req.body || {}) }); }
    catch (e) { fail(res, e); }
  });
  app.delete('/api/licence/computers', async (req, res) => {
    try {
      const r = await pool.forget();
      res.json({ ok: true, said: r.left.length ? `Removed. The licence server did not free the seats of ${r.left.join(', ')}: free them there.` : 'Removed, and every seat it held was freed.', pool: pool.view() });
    } catch (e) { fail(res, e); }
  });
  app.delete('/api/licence/computers/seats/:computer', async (req, res) => {
    try {
      const r = await pool.release(req.params.computer, { reason: 'freed at Settings → System → Licence' });
      if (!r) return res.status(404).json({ error: 'That computer holds no seat.', code: 'no_seat' });
      res.status(r.freed ? 200 : 502).json({ ok: r.freed, said: r.freed ? 'The seat is free.' : `Not freed yet: ${r.why}`, pool: pool.view() });
    } catch (e) { fail(res, e); }
  });
}

module.exports = { mount };
