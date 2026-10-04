'use strict';

/**
 * The face's feed and its kiosk page (TODO H8.1). `GET /api/face/stream` is an SSE stream of the state this
 * viewer may see ({state, detail}), sent on every change and as a heartbeat; `/face` is the full-screen page.
 */
const face = require('./state');

function mount(app) {
  app.get('/face', (_req, res) => res.redirect('/face.html'));
  app.get('/api/face/stream', (req, res) => {
    require('../utils').sseHeaders(res);
    const person = require('../harness/turn/client').dashboardClient(req).user;
    let last = '';
    const send = force => {
      const v = JSON.stringify(face.viewFor(person));
      if (!force && v === last) return;
      last = v;
      try { res.write(`data: ${v}\n\n`); } catch { /* gone */ }
    };
    const off = face.subscribe(() => send(false));
    const beat = setInterval(() => send(true), 15000);
    send(true);
    res.on('close', () => { off(); clearInterval(beat); });
  });
}

module.exports = { mount };
