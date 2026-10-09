'use strict';

/**
 * The meetings' routes (right `chat` in auth/rights.js; each meeting checked by its people, access.js):
 *
 *   GET    /api/meetings                      mine, newest first, and my calendar connection
 *   POST   /api/meetings                      {title, start?, minutes?, tz?, people:[ids], emails:[], note?, space?, now?, open?}
 *   GET    /api/meetings/people               the people of my organisation a meeting can invite (names only)
 *   GET    /api/meetings/calendar             my own calendar's connection; POST …/calendar/:provider/connect; DELETE …/calendar
 *   GET    /api/meetings/devices              my machines that can take a controller's input (control.js)
 *   GET    /api/meetings/:id                  one meeting, its people and who is in its room
 *   PATCH  /api/meetings/:id                  change it (its organizer); POST …/cancel, …/confirm (a proposed one), …/end
 *   GET    /api/meetings/:id/invite.ics       add it to any calendar
 *   POST   /api/meetings/:id/{join,leave,signal,media,share,say}      the room, from a page's live stream {screen, …}
 *   POST   /api/meetings/:id/control/{request,offer,confirm,input,revoke}   take control, with the sharer's two consents
 *   GET    /meet/:id                          the link: the panel, opening the room
 *
 * A page names its live stream (`screen`, from /api/live/stream's hello); only the person who opened that stream acts
 * for it (live/routes.owns), so one person's page can never speak for another's.
 */
const meetings = require('./index');
const rooms = require('./rooms');
const control = require('./control');

const personOf = req => require('../harness/turn/client').dashboardClient(req).user;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const h = fn => async (req, res) => {
  try { res.json(await fn(req, personOf(req))); }
  catch (e) { res.status(e.status || 500).json({ error: e.message, ...(e.code ? { code: e.code } : {}) }); }
};

/** The page's own live stream, or a refusal: a page acts in a room only through the stream it opened. */
function screenOf(req) {
  const s = String(req.body?.screen || '');
  if (!s || !require('../live/routes').owns(req, s)) throw bad('This page\'s live stream is not open (it reconnects by itself; then join again).', 409);
  return s;
}

const room = async (req, person) => { const m = await meetings.reachable(req.params.id, person); if (['cancelled', 'ended'].includes(m.state) && m.ownerId !== person.id) throw bad(`This meeting is ${m.state}.`, 410); return m; };
const callback = req => `${req.protocol}://${req.get('host')}/api/connectors/callback`;

function mount(app) {
  rooms.start();
  app.get('/meet/:id', (req, res) => res.redirect(302, `/?meet=${encodeURIComponent(String(req.params.id).slice(0, 40))}`));
  app.get('/api/meetings', h(async (req, person) => {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const list = await require('./store').forPerson(person.id, { since });
    return { meetings: await Promise.all(list.map(m => meetings.view(m, person))), calendar: require('./calendars').view(person.id), max: rooms.max() };
  }));
  app.post('/api/meetings', h((req, person) => meetings.create(person, req.body || {}, req)));
  app.get('/api/meetings/people', h((req, person) => ({ people: require('./access').directory(person.orgId).filter(p => p.id !== person.id) })));
  app.get('/api/meetings/calendar', h((req, person) => require('./calendars').view(person.id)));
  app.post('/api/meetings/calendar/:provider/connect', h((req, person) => require('./calendars').connect(person, req.params.provider, callback(req))));
  app.delete('/api/meetings/calendar', h((req, person) => { require('./calendars').disconnect(person.id); return require('./calendars').view(person.id); }));
  app.get('/api/meetings/devices', h((req, person) => ({ devices: control.machines(person.id).map(d => ({ id: d.id, name: d.name })) })));

  app.get('/api/meetings/:id', h(async (req, person) => ({ meeting: await meetings.view(await meetings.reachable(req.params.id, person), person) })));
  app.patch('/api/meetings/:id', h((req, person) => meetings.update(req.params.id, person, req.body || {})));
  app.post('/api/meetings/:id/cancel', h((req, person) => meetings.cancel(req.params.id, person)));
  app.post('/api/meetings/:id/confirm', h((req, person) => meetings.confirm(req.params.id, person, req)));
  app.post('/api/meetings/:id/end', h((req, person) => meetings.end(req.params.id, person)));
  app.get('/api/meetings/:id/invite.ics', async (req, res) => {
    try {
      const m = await meetings.reachable(req.params.id, personOf(req));
      if (!m.startsAt || !m.endsAt) throw bad('This call has no time to put in a calendar.', 409);
      res.type('text/calendar; charset=utf-8').set('Content-Disposition', `attachment; filename="${m.id}.ics"`)
        .send(await require('./invite').icsFor(m, m.state === 'cancelled' ? 'CANCEL' : 'REQUEST'));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // The room, from a page.
  app.post('/api/meetings/:id/join', h(async (req, person) => {
    const m = await room(req, person);
    if (m.state === 'proposed') throw bad('This meeting is still a proposal: its organizer confirms it first.', 409);
    const out = rooms.join(m, person, screenOf(req), req.body?.media || {});
    if (m.state === 'scheduled' && Date.parse(m.startsAt) - Date.now() < 15 * 60000) await require('./store').update(m.id, { state: 'open' });
    return { ...out, meeting: await meetings.view(m, person), iceServers: iceServers() };
  }));
  app.post('/api/meetings/:id/leave', h(async (req, person) => { await room(req, person); return { left: rooms.leave(req.params.id, screenOf(req)) }; }));
  app.post('/api/meetings/:id/signal', h(async (req, person) => { await room(req, person); rooms.signal(req.params.id, screenOf(req), req.body?.to, req.body?.data); return { ok: true }; }));
  app.post('/api/meetings/:id/media', h(async (req, person) => { await room(req, person); rooms.media(req.params.id, screenOf(req), req.body || {}); return { ok: true }; }));
  app.post('/api/meetings/:id/share', h(async (req, person) => { await room(req, person); return { sharing: rooms.share(req.params.id, screenOf(req), !!req.body?.on, req.body || {}) }; }));
  app.post('/api/meetings/:id/say', h(async (req, person) => { await room(req, person); return { line: rooms.say(req.params.id, screenOf(req), req.body?.text) }; }));

  // Take control: the viewer asks, the sharer offers (1) and confirms (2), the controller's input, either ends it.
  app.post('/api/meetings/:id/control/request', h(async (req, person) => { await room(req, person); return control.request(req.params.id, screenOf(req), req.body?.to); }));
  app.post('/api/meetings/:id/control/offer', h(async (req, person) => { await room(req, person); return control.offer(req.params.id, screenOf(req), req.body || {}); }));
  app.post('/api/meetings/:id/control/confirm', h(async (req, person) => { await room(req, person); return control.confirm(req.params.id, screenOf(req), req.body?.grant); }));
  app.post('/api/meetings/:id/control/input', h(async (req, person) => { await room(req, person); return control.input(req.params.id, screenOf(req), req.body?.grant, req.body || {}); }));
  app.post('/api/meetings/:id/control/revoke', h(async (req, person) => { await room(req, person); return control.revoke(req.params.id, screenOf(req), req.body?.grant || null); }));
}

/** STUN/TURN for a page: none by default (host candidates: the tailnet and the LAN); meetings.iceUrls adds some. */
function iceServers() {
  let urls = [];
  try { urls = require('../settings-schema').value('meetings.iceUrls') || []; } catch { /* the default */ }
  return urls.filter(u => /^(stun|turns?):/.test(String(u))).map(u => ({ urls: String(u) }));
}

module.exports = { mount, iceServers };
