'use strict';

/**
 * Other people's work (oversight/index.js), for the header's icon and Settings → General:
 *
 *   GET  /api/oversight          {on, unread, items, seenAt}: newest first, only what this host may open
 *   POST /api/oversight/seen     read up to now (or `at`): the unread count goes to zero
 *   POST /api/oversight/switch   {on}: this person's opt-in
 *
 * Host at the gate (the conversations are the machine's); each item is someone else's conversation this person may
 * open (session-access.mayUse). No device route: a person's devices hear only their own work (3.101.0).
 */
const o = require('./index');

const actorOf = req => require('../harness/turn/client').personOf(req.auth);

function mount(app) {
  const h = fn => (req, res) => {
    const me = actorOf(req);
    if (!o.allowed(me)) return res.status(403).json({ error: 'Other people\'s work is for whoever holds host.' });
    try { res.json(fn(req, me)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  };
  app.get('/api/oversight', h((req, me) => o.view(me)));
  app.post('/api/oversight/seen', h((req, me) => {
    const at = typeof req.body?.at === 'string' && !Number.isNaN(Date.parse(req.body.at)) ? new Date(req.body.at).toISOString() : undefined;
    o.markSeen(me, at);
    return o.view(me);
  }));
  app.post('/api/oversight/switch', h((req, me) => { o.setOn(me, req.body?.on !== false); return o.view(me); }));
}

module.exports = { mount };
