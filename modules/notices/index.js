'use strict';

/**
 * The panel's own notices (deep test B, 2026-10-08): what a reminder or the agent's `tell_device` says to a person,
 * drawn on their open pages. A signed-in browser is a device record with no scopes, so the bus's `alert` never
 * reached the panel — on a browser-only install every reminder reached nobody. A notice is kept per person until
 * they dismiss it, so a page opened after it fired still shows it, and goes out on the live feed's `notice` topic
 * to that person's pages only (live/routes.js).
 *
 *   { id, personId, title, text, from, at, seenAt, link? }
 *
 * `link` ({label, href}) is a place in the panel the notice is about — `#<page>` with a query of plain words
 * (`#connectors?draft=svc_1a2b`), never an address elsewhere.
 */
const crypto = require('crypto');
const store = require('../store');

const DOC = 'notices';
const KEEP = 200;                     // across everyone; the oldest go first
const KEEP_MS = 14 * 24 * 3600e3;     // and none older than two weeks

const rows = () => store.readJson(DOC, { notices: [] }).notices || [];
const write = list => store.writeJson(DOC, { notices: list.slice(-KEEP) });
const whose = personId => personId || null;

/** Keep a notice for `personId` (null: the hive's, every host's) and draw it on their open pages. */
const LINK = /^#[a-z][a-z-]{0,30}(\?[\w=&.-]{0,120})?$/;

function post({ personId = null, title, text = '', from = 'hub', link = null } = {}) {
  const head = String(title || text || '').trim();
  if (!head) throw new Error('A notice needs something to say.');
  const n = { id: `ntc_${crypto.randomBytes(6).toString('hex')}`, personId: whose(personId), title: head.slice(0, 160),
    text: title ? String(text || '').slice(0, 2000) : '', from: String(from).slice(0, 60), at: new Date().toISOString(), seenAt: null,
    ...(link && LINK.test(String(link.href || '')) ? { link: { label: String(link.label || 'Open').slice(0, 40), href: String(link.href) } } : {}) };
  const since = Date.now() - KEEP_MS;
  write([...rows().filter(x => Date.parse(x.at) > since), n]);
  require('../live').changed('notice', n.id, 'new', { personId: n.personId, notice: n });
  return { notice: n, pages: require('../live/routes').pagesOf(n.personId) };
}

const mine = (n, p, host) => (n.personId ? n.personId === (p?.id || null) : host);

/** The notices this person has not dismissed, newest first. */
function list(person, host) { return rows().filter(n => !n.seenAt && mine(n, person, host)).reverse(); }

function seen(person, host, id) {
  let hit = null;
  write(rows().map(n => (n.id === id && mine(n, person, host) ? (hit = { ...n, seenAt: new Date().toISOString() }) : n)));
  if (!hit) throw Object.assign(new Error('No such notice.'), { status: 404 });
  require('../live').changed('notice', id, 'seen', { personId: hit.personId });
  return hit;
}

function mount(app) {
  const who = req => {
    const p = require('../harness/turn/client').dashboardClient(req).user;
    return { p, host: !p?.id || require('../harness/session-access').isHost(p) };
  };
  app.get('/api/notices', (req, res) => { const { p, host } = who(req); res.json({ notices: list(p, host) }); });
  app.post('/api/notices/:id/seen', (req, res) => {
    const { p, host } = who(req);
    try { res.json({ ok: true, notice: seen(p, host, req.params.id) }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { post, list, seen, mount };
