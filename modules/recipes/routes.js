'use strict';

/**
 * Recipes in the panel (TODO H3): the list, one recipe, saving (by hand or from a conversation's last turn),
 * running, exporting, deleting. A run acts with the signed-in person's level and asks their approvals, so
 * reading and running is `chat`; deleting a recipe the hive shares is `host` (rights.js).
 */
const store = require('./store');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const person = req => require('../harness/turn/client').dashboardClient(req).user;

function mount(app) {
  app.get('/api/recipes', h(() => ({ recipes: store.list().map(r => { const p = store.proposed(r.id); return p ? { ...r, proposed: { revision: p.revision, proposedAt: p.proposedAt, why: p.why, steps: p.steps } } : r; }) })));
  app.post('/api/recipes', h(req => store.save({ ...(req.body || {}), by: req.auth?.user?.id || null })));
  app.post('/api/recipes/from-session', h(req => {
    const { sessionId, title, description, params } = req.body || {};
    require('../harness/session-access').check(person(req), sessionId);
    const lifted = store.fromTurn(sessionId, { params: Array.isArray(params) ? params : [] });
    return store.save({ title, description, ...lifted, by: req.auth?.user?.id || null, from: { sessionId } });
  }));
  app.get('/api/recipes/:id', h(req => store.get(req.params.id) || Promise.reject(Object.assign(new Error('No such recipe.'), { status: 404 }))));
  app.get('/api/recipes/:id/export', async (req, res) => {
    try {
      const r = store.get(req.params.id);
      if (!r) return res.status(404).json({ error: 'No such recipe.' });
      const out = require('./export').exportAs(r, String(req.query.format || 'json'));
      res.set('Content-Disposition', `attachment; filename="${out.name}"`).type(out.mime).send(out.body);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/recipes/:id/run', async (req, res) => {
    const ctrl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });   // hanging up stops it, as with a turn
    try {
      const r = store.get(req.params.id);
      if (!r) return res.status(404).json({ error: 'No such recipe.' });
      const client = require('../harness/turn/client').dashboardClient(req);
      res.json(await require('./run').run(r, { params: req.body?.values || {}, person: client.user, client, signal: ctrl.signal }));
    } catch (e) { if (!res.headersSent) res.status(e.status || 500).json({ error: e.message }); }
  });
  app.delete('/api/recipes/:id', h(req => store.remove(req.params.id)));
  // A proposed revision (the recipe-repair experiment): a person accepts it as the next revision, or discards it.
  app.post('/api/recipes/:id/accept', h(req => store.accept(req.params.id)));
  app.post('/api/recipes/:id/discard', h(req => store.discard(req.params.id)));
}

module.exports = { mount };
