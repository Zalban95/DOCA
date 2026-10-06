'use strict';

/** The Workstream's routes (index.js): what just happened, and a page holding it open. Host: the machine's files and every conversation's thinking. */
function mount(app) {
  const ws = require('./index');
  ws.start();
  app.get('/api/workstream', (_req, res) => res.json(ws.snapshot()));
  app.post('/api/workstream/hold', (req, res) => {
    const screen = String(req.body?.screen || '');
    if (!require('../live/routes').owns(req, screen)) return res.status(404).json({ error: 'No such live stream on this page; it reconnects by itself.' });
    res.json(ws.hold(screen, req.body?.on !== false));
  });
}

module.exports = { mount };
