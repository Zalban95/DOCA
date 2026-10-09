'use strict';

/**
 * The Home page's routes (index.js). Reading the home is `read` and acting on it `chat` (rights.js); each entity is
 * further the person's only when allotted (auth/allot.js `home`). `home` (a query or a body field) picks one of the
 * homes there are (`hub`, or a home node's id); absent, the first.
 *   GET  /api/home[?home=]          the homes there are, and the chosen one as this person sees it: areas and tiles,
 *                                   or how to connect HA; a home node away answers what it last said, `offline`
 *   POST /api/home/hold {screen,on} a page holding the Home page open: the connection stays and changes stream to it
 *   POST /api/home/call             {home, domain, service, entity_id, data} — the short list in actions.js
 *   GET  /api/home/camera/:entity[?home=]  a camera's still, fetched with the token where it is kept, kept a few seconds
 */
const home = require('./index');
const actions = require('./actions');

const person = req => require('../harness/turn/client').dashboardClient(req).user;
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });

const SHOT_MS = 5000, SHOT_MAX = 5 * 1024 * 1024;
const _shots = new Map();   // entity → {at, type, buf}: a wall of tablets asking at once is one request to HA

async function still(src, id) {
  const key = `${src.home} ${id}`;
  const kept = _shots.get(key);
  if (kept && Date.now() - kept.at < SHOT_MS) return kept;
  const { type: t, buf } = await src.camera(id);
  if (buf.length > SHOT_MAX) throw Object.assign(new Error('The camera\'s picture is too large to pass on.'), { status: 502 });
  const type = String(t || '').split(';')[0].trim();
  const shot = { at: Date.now(), type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type) ? type : 'image/jpeg', buf };   // never an SVG: a document
  _shots.set(key, shot);
  for (const [k2, v] of _shots) if (Date.now() - v.at > 60000) _shots.delete(k2);
  return shot;
}

function mount(app) {
  home.start();
  app.get('/api/home', async (req, res) => { try { res.json(await home.view(person(req), req.query.home ? String(req.query.home) : null)); } catch (e) { fail(res, e); } });
  app.post('/api/home/hold', async (req, res) => {
    const screen = String(req.body?.screen || '');
    if (!require('../live/routes').owns(req, screen)) return res.status(404).json({ error: 'No such live stream on this page; it reconnects by itself.' });
    res.json(await home.hold(screen, req.body?.on !== false));
  });
  app.post('/api/home/call', async (req, res) => { try { res.json(await actions.call(person(req), req.body || {})); } catch (e) { fail(res, e); } });
  app.get('/api/home/camera/:entity', async (req, res) => {
    const id = String(req.params.entity);
    try {
      const src = home.source(req.query.home ? String(req.query.home) : null);
      await src.ready();
      if (!/^camera\.[a-z0-9_]+$/.test(id) || !src.has(id)) return res.status(404).json({ error: `No camera ${id}.` });
      if (!home.allowed(person(req), id, src.home)) return res.status(403).json({ error: `${id} is not allotted to you.` });
      const s = await still(src, id);
      res.set({ 'Content-Type': s.type, 'Cache-Control': 'private, max-age=5', 'X-Content-Type-Options': 'nosniff' }).send(s.buf);
    } catch (e) { fail(res, e); }
  });
}

module.exports = { mount };
