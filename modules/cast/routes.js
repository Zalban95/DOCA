'use strict';

/**
 * Casting (docs/design/cast-and-devices.md, phase 1: DOCA screens):
 *   GET  /api/cast/targets        the screens a person may cast to: their own browsers (an admin's: every one), with what
 *                                 each shows and whether it is kept there
 *   POST /api/cast/show           {screen, page, focus?, keep?} — that screen shows the page alone (`/?view=`), shaped by
 *                                 its own settings, kept there when `keep`
 *   POST /api/cast/stop           {screen} — the cast ends: a screen a view link made is signed out (its record revoked)
 *   POST /api/cast/links          {page, focus?, name?} — a view link for a screen that cannot sign in (cast/links.js)
 *   GET  /api/cast/open/:code     opening it, on that screen: public (it cannot sign in), once, ten minutes
 */
const links = require('./links');
const VIEWS = () => require('./views').VIEWS;
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const h = fn => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const isHost = who => require('../auth/rights').can(who?.role, 'host');

/** A screen this person may cast to: their own browser record (an admin's: any), not revoked or put away. */
function target(who, id) {
  const d = require('../api-v1/devices').get(String(id || ''));
  if (!d || d.kind !== 'browser' || d.revokedAt || d.archivedAt) throw bad('Not a screen of this hive.', 404);
  if (!isHost(who) && d.userId !== who.user.id) throw bad('Not a screen of yours.', 404);
  return d;
}

function targets(req) {
  const who = req.auth, own = req.auth?.session?.screen || null;
  const seen = require('../screens/showing').all();   // {screenId: {page, solo, visible, at}} — what each showed lately
  const list = require('../api-v1/devices').list()
    .filter(d => d.kind === 'browser' && !d.revokedAt && !d.archivedAt && (isHost(who) || d.userId === who.user.id))
    .map(d => ({ id: d.id, name: d.name, mine: d.userId === who.user.id, here: d.id === own,
      shows: seen[d.id]?.page || d.cast?.page || null, lastSeen: d.lastSeenAt || null, cast: d.cast || null }))
    .sort((a, b) => (b.cast?.keep ? 1 : 0) - (a.cast?.keep ? 1 : 0) || String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));
  return { targets: list, pages: Object.fromEntries(Object.entries(VIEWS()).map(([id, v]) => [id, v.label])) };
}

function show(req) {
  const { screen, page, focus = null, keep = false } = req.body || {};
  const d = target(req.auth, screen);
  if (d.cast?.view && d.cast.page !== page) throw bad(`That screen was made to show ${VIEWS()[d.cast.page]?.label || d.cast.page} only: make a new link for another page.`, 409);
  require('../screens/showing').show(d.id, { page, solo: true });
  const devices = require('../api-v1/devices');
  devices.update(d.id, { cast: { ...(d.cast || {}), page, focus: focus ? String(focus).slice(0, 120) : null, keep: keep === true, by: req.auth.user.id, at: new Date().toISOString() } });
  require('../activity').note({ from: 'cast', what: `cast ${page} to ${d.name}${keep ? ', kept there' : ''}`, why: 'a person cast it', person: { id: req.auth.user.id, name: req.auth.user.name || req.auth.user.email },
    machine: { kind: 'screen', id: d.id, name: d.name }, act: 'cast' });
  return { ok: true, screen: devices.get(d.id) };
}

function stop(req) {
  const d = target(req.auth, req.body?.screen);
  const devices = require('../api-v1/devices'), made = !!d.cast?.view;   // read before the record changes below
  if (made) devices.revoke(d.id);   // a screen a view link made: signed out, its link spent
  devices.update(d.id, { cast: null });
  require('../activity').note({ from: 'cast', what: `stopped the cast on ${d.name}`, why: 'a person stopped it', person: { id: req.auth.user.id, name: req.auth.user.name || req.auth.user.email },
    machine: { kind: 'screen', id: d.id, name: d.name }, act: 'stop' });
  return { ok: true, signedOut: made };
}

function mount(app) {
  require('./routes-things').mount(app);   // things Nearby saved: TVs and speakers (cast/things.js)
  app.get('/api/cast/targets', h(targets));
  app.post('/api/cast/show', h(show));
  app.post('/api/cast/stop', h(stop));
  // The link with each address this hub answers on, and its QR code, for the screen to open (network.links).
  app.post('/api/cast/links', async (req, res) => {
    try {
      const l = links.create(req.body || {}, req.auth);
      const qrcode = (() => { try { return require('qrcode'); } catch { return null; } })();
      const urls = [];
      for (const a of (await require('../network').links(req, { qr: false })).links) {
        const url = `${a.url.replace(/\/$/, '')}${l.path}`;
        let qr = null;
        try { qr = qrcode ? await qrcode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 220, color: { dark: '#000000', light: '#ffffff' } }) : null; } catch { /* no code drawn */ }
        urls.push({ label: a.label, url, qr });
      }
      res.json({ ...l, urls });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.get('/api/cast/open/:code', (req, res) => {
    try {
      const r = links.open(req.params.code, req);
      res.setHeader('Set-Cookie', r.cookies);
      res.redirect(302, r.location);
    } catch (e) { res.status(e.status || 500).type('text').send(e.message); }
  });
}

module.exports = { mount, targets, show, stop };
