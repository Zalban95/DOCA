'use strict';

/**
 * What each screen is showing, and sending a page to one (asked 2026-10-06: "if I wanted to serve some of these panels
 * or dedicate a screen to the working agents I'd just open the page"). A browser's presence heartbeat says which page
 * it shows and whether alone (`/?view=<page>`: the page by itself, full window); the Devices list reads it per screen.
 * An admin can send a page to a screen — a wall tablet, a desk client's tab — and that screen opens it, through the
 * live feed (topic `screen`, heard only by that screen's own pages). In memory: what is on a screen is a reading.
 */
const FRESH_MS = 75e3;
const _shown = new Map();   // screen (browser device id) → { page, solo, visible, at }

const PAGE = /^[a-z][a-z0-9-]{0,30}$/;

function beat(screen, { page, solo, visible } = {}) {
  if (!screen) return;
  _shown.set(screen, { page: PAGE.test(String(page || '')) ? String(page) : null, solo: solo === true, visible: visible !== false, at: Date.now() });
}

/** screen → what it shows, for those heard from lately. */
function all(now = Date.now()) {
  return Object.fromEntries([..._shown].filter(([, v]) => now - v.at < FRESH_MS).map(([k, v]) => [k, { ...v, ago: now - v.at }]));
}

/** Ask one screen to show a page (alone, or in the panel). */
function show(screen, { page, solo = false } = {}) {
  if (!PAGE.test(String(page || ''))) throw Object.assign(new Error('Which page? e.g. harness, projects, computers.'), { status: 400 });
  const d = require('../api-v1/devices').get(String(screen || ''));
  if (!d || d.kind !== 'browser' || d.revokedAt || d.archivedAt) throw Object.assign(new Error('Not a screen of this hive.'), { status: 404 });
  require('../live').changed('screen', d.id, 'show', { page: String(page), solo: solo === true });
  return { sent: true, screen: d.id, page, solo: solo === true, showing: all()[d.id] ? 'heard from lately' : 'not heard from lately: it shows the page when it next opens the panel' };
}

/**
 * Every open page reloads (asked 2026-10-10: "the refresh button … should also refresh all the clients' pages; the
 * version isn't shown updated unless the app is closed and reopened"). An admin's `every` reaches every signed-in page
 * of the hive — a phone's app is a page too; anyone else reloads their own pages only. A page being edited asks first.
 */
function reload(person, { every = false } = {}) {
  const host = !person?.id || require('../harness/session-access').isHost(person);
  if (every && !host) throw Object.assign(new Error('Reloading everyone\'s screens is an admin\'s; yours reload with every: false.'), { status: 403 });
  const personId = every ? null : person?.id || null;
  require('../live').changed('screen', null, 'reload', { personId, every: !personId, by: person?.name || null });
  return { sent: true, every: !personId, pages: personId ? require('../live/routes').pagesOf(personId) : require('../live/routes').pagesAll() };
}

function mount(app) {
  app.post('/api/screen/reload', (req, res) => {
    try { res.json(reload(require('../harness/turn/client').dashboardClient(req).user, { every: req.body?.every === true })); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.get('/api/screens/showing', (_req, res) => res.json({ screens: all() }));
  app.post('/api/screens/:id/show', (req, res) => {
    try { res.json(show(req.params.id, req.body || {})); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { beat, all, show, reload, mount };
