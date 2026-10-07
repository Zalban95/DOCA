'use strict';

/**
 * Chronicle's routes (index.js, story.js). Right `read`: every row is scoped to the viewer by the transcript's own
 * rule, so a person sees the runs of their own conversations and devices, and a host everything.
 */
function mount(app) {
  const who = req => require('../harness/turn/client').dashboardClient(req).user;
  const h = fn => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/api/chronicle', h(req => require('./index').query(who(req), req.query || {})));
  app.get('/api/chronicle/story', h(req => require('./story').story(who(req), req.query || {})));
}

module.exports = { mount };
