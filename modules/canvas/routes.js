'use strict';

/**
 * /api/harness/canvases — what the panel needs to open a canvas: its title,
 * its revisions and its address on the canvas origin. The page itself is never
 * served here (./origin.js says why).
 */
const canvases = require('./store');
const { CANVAS_PORT } = require('../paths');

function mount(app) {
  app.get('/api/harness/canvases', (req, res) =>
    res.json({ canvases: canvases.list({ sessionId: req.query.sessionId || undefined }) }));
  app.get('/api/harness/canvases/:id', (req, res) => {
    const c = canvases.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'No such canvas.' });
    res.json({ canvas: canvases.summary(c), port: CANVAS_PORT, path: `/c/${c.token}` });
  });
}

module.exports = { mount };
