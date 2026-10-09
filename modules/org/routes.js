'use strict';

/**
 * The organisation tree in the panel (org/index.js):
 *   GET   /api/org                 the tree of the viewer's organisation, and whether they may change it
 *   GET   /api/org/people/:id      one person's card (Settings → Users and the chat open it)
 *   PATCH /api/org/people/:id      {managerId, team, title} — an admin, or a team leader for the people below them
 * Reading is any signed-in person's (rights.js `read`): colleagues see each other's names, teams and titles, never an
 * email unless they hold `users`. Changing is `chat` at the gate and org.setPlace decides who.
 */
const org = require('./index');

const who = req => require('../harness/turn/client').dashboardClient(req).user;
const orgOf = p => p?.orgId || require('../auth/store').defaultOrg()?.id;
const h = fn => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const admin = p => require('../auth/rights').can(p?.role, 'users');

/** A tree without emails for someone who does not manage people. */
function strip(nodes, keep) { return nodes.map(n => ({ ...n, email: keep ? n.email : undefined, reports: strip(n.reports || [], keep) })); }

function mount(app) {
  app.get('/api/org', h(req => {
    const p = who(req), id = orgOf(p);
    const store = require('../auth/store');
    const rights = require('../auth/levels').rightsOf(p?.role);
    return { org: { id, name: (id && store.defaultOrg()?.id === id ? store.defaultOrg()?.name : null) || 'This hive' },
      tree: strip(org.tree(id), admin(p)), me: p?.id || null,
      may: { place: rights.includes('users') ? 'anyone' : rights.includes('delegate') ? 'below' : 'none' } };
  }));
  app.get('/api/org/people/:id', h(req => org.card(who(req), req.params.id)));
  app.patch('/api/org/people/:id', h(req => org.setPlace(who(req), req.params.id, req.body || {})));
}

module.exports = { mount };
