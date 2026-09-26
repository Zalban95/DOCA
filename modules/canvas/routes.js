'use strict';

/**
 * /api/harness/canvases — what the panel needs to open a canvas: its title,
 * its revisions and its address on the canvas origin. The page itself is never
 * served here (./origin.js says why).
 */
const canvases = require('./store');
const { CANVAS_PORT } = require('../paths');

function mount(app) {
  // Previews (./previews.js): a localhost port, shown through the canvas origin.
  const previews = require('./previews');
  app.post('/api/harness/previews', (req, res) => {
    try {
      const p = previews.create({ port: req.body?.port, title: req.body?.title });
      res.json({ preview: { id: p.id, port: p.port, title: p.title, expiresAt: p.expiresAt } });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.get('/api/harness/previews/:id', (req, res) => {
    const p = previews.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'No such preview, or it has expired.' });
    res.json({ preview: { id: p.id, port: p.port, title: p.title, expiresAt: p.expiresAt }, canvasPort: CANVAS_PORT, path: `/p/${p.token}` });
  });

  app.get('/api/harness/canvases', (req, res) =>
    res.json({ canvases: canvases.list({ sessionId: req.query.sessionId || undefined }) }));
  app.get('/api/harness/canvases/:id', (req, res) => {
    const c = canvases.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'No such canvas.' });
    res.json({ canvas: canvases.summary(c), port: CANVAS_PORT, path: `/c/${c.token}` });
  });
}

module.exports = { mount };
