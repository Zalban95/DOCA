'use strict';

/**
 * Casting to things Nearby saved (cast/things.js; docs/design/cast-reach.md phase A):
 *   GET  /api/cast/things                 the person's Cast devices by place and room, and whether the door is on
 *   POST /api/cast/things/:id/show        {page}   a TV shows the page (DashCast, through the door)
 *   POST /api/cast/things/:id/say         {text}   a speaker says it in the person's Quick call voice
 *   POST /api/cast/things/:id/stop                 what the receiver plays or shows stops
 *   POST /api/cast/things/:id/volume      {level}  0–1
 *   POST /api/cast/door                   {on}     the owner's switch (cast.door), with the password (auth/guarded.js)
 *   GET  /api/cast/media/:token                    a one-time sound, to the one address it is for (cast/media.js)
 */
const things = require('./things');
const isHost = who => require('../auth/rights').can(who?.role, 'host');
const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };

function mount(app) {
  require('./door').attach(app);
  app.get('/api/cast/things', h(req => ({ things: things.list(req.auth), door: { on: require('./door').on(), mayChange: isHost(req.auth) } })));
  app.post('/api/cast/things/:id/show', h(req => things.show(req.auth, req.params.id, String(req.body?.page || ''))));
  app.post('/api/cast/things/:id/say', h(req => things.say(req.auth, req.params.id, req.body?.text)));
  app.post('/api/cast/things/:id/stop', h(req => things.stop(req.auth, req.params.id)));
  app.post('/api/cast/things/:id/volume', h(req => things.volume(req.auth, req.params.id, req.body?.level)));
  app.post('/api/cast/door', h(req => {
    const on = req.body?.on === true;
    const { loadPrefs, savePrefs } = require('../utils');
    const prefs = loadPrefs();
    savePrefs({ ...prefs, cast: { ...(prefs.cast || {}), door: on ? 'on' : 'off' } });
    if (!on) require('./door').close().catch(() => {});
    require('../activity').note({ from: 'person', what: `${on ? 'switched on' : 'switched off'} casting to devices on this network (the cast door)`, why: 'Cast sheet',
      person: { id: req.auth.user.id, name: req.auth.user.name || req.auth.user.email } });
    return { on };
  }));
  app.get('/api/cast/media/:token', (req, res) => require('./media').serve(req, res));
}

module.exports = { mount };
