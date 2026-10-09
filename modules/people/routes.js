'use strict';

/**
 * The hive chat in the panel (Controls → Chat, and the floating chat's People). Reading is `read` at the gate, the rest
 * `chat`, the export `org` (auth/rights.js); spaces.js and messages.js decide per space, and answer 404 for one the
 * person is not in.
 *
 *   GET    /api/people                            the person's list: spaces (unread, last line), channels to join, their agents
 *   GET    /api/people/directory                  who they may message, with team and title
 *   POST   /api/people/dm {person}                the direct conversation with someone
 *   POST   /api/people/spaces {kind, name, …}     a group or a channel
 *   GET    /api/people/spaces/:id                 one space, its members and pins
 *   PATCH  /api/people/spaces/:id                 {name, topic, archived}
 *   POST   /api/people/spaces/:id/(join|leave)    a channel
 *   POST   /api/people/spaces/:id/members {add}   people added
 *   POST   /api/people/spaces/:id/mine {muted}    the person's own settings for it
 *   GET    /api/people/spaces/:id/messages        ?before|after=<seq>&limit, or ?thread=<message id>
 *   POST   /api/people/spaces/:id/messages        {text, replyTo, attachments}
 *   POST   /api/people/spaces/:id/(read|typing)   {seq} / nothing
 *   PATCH  /api/people/messages/:id {text}        DELETE /api/people/messages/:id
 *   POST   /api/people/messages/:id/(react|pin)   {emoji, on} / {on}
 *   GET    /api/people/search?q=                  in their own spaces
 *   POST   /api/people/export                     the owner's compliance export (password, audit)
 */
const spaces = require('./spaces');
const messages = require('./messages');

const who = req => require('../harness/turn/client').dashboardClient(req).user;
const h = fn => async (req, res) => {
  try {
    const p = who(req);
    if (!p?.id) return res.status(403).json({ error: 'The hive chat is between people: sign in as one.' });
    res.json(await fn(req, p));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};

function directory(p) {
  const policy = require('./policy');
  const all = require('../org').people(policy.orgOf(p));
  return all.filter(x => x.id !== p.id).map(x => ({ id: x.id, name: x.name, team: x.team, title: x.title, levelName: x.levelName,
    atPanel: require('../presence').state(Date.now(), x.id).atPanel, may: policy.mayStart(p, x.id) === null }));
}

function mount(app) {
  if (require('../license').featureOn('hive-chat')) { require('./agent-bridge').listen(); require('./keep').start(); }   // unlicensed: no tables, nothing to do
  app.get('/api/people', h((req, p) => spaces.list(p)));
  app.get('/api/people/directory', h((req, p) => ({ people: directory(p) })));
  app.get('/api/people/search', h((req, p) => messages.search(p, req.query.q)));
  app.post('/api/people/export', h((req, p) => require('./keep').exportAll(p)));
  app.post('/api/people/dm', h((req, p) => spaces.dm(p, String(req.body?.person || ''))));
  app.post('/api/people/spaces', h((req, p) => spaces.create(p, req.body || {})));
  app.get('/api/people/spaces/:id', h((req, p) => spaces.view(p, req.params.id)));
  app.patch('/api/people/spaces/:id', h((req, p) => spaces.patch(p, req.params.id, req.body || {})));
  app.post('/api/people/spaces/:id/join', h((req, p) => spaces.join(p, req.params.id)));
  app.post('/api/people/spaces/:id/leave', h((req, p) => spaces.leave(p, req.params.id)));
  app.post('/api/people/spaces/:id/members', h((req, p) => spaces.add(p, req.params.id, [].concat(req.body?.add || []))));
  app.post('/api/people/spaces/:id/mine', h((req, p) => spaces.mine(p, req.params.id, req.body || {})));
  app.get('/api/people/spaces/:id/messages', h((req, p) => messages.list(p, req.params.id, req.query)));
  app.post('/api/people/spaces/:id/messages', h((req, p) => messages.post(p, req.params.id, req.body || {}, { client: require('../harness/turn/client').dashboardClient(req) })));
  app.post('/api/people/spaces/:id/read', h((req, p) => messages.read(p, req.params.id, req.body?.seq)));
  app.post('/api/people/spaces/:id/typing', h((req, p) => messages.typing(p, req.params.id)));
  app.patch('/api/people/messages/:id', h((req, p) => messages.edit(p, req.params.id, req.body?.text)));
  app.delete('/api/people/messages/:id', h((req, p) => messages.remove(p, req.params.id)));
  app.post('/api/people/messages/:id/react', h((req, p) => messages.react(p, req.params.id, req.body?.emoji, req.body?.on !== false)));
  app.post('/api/people/messages/:id/pin', h((req, p) => messages.pin(p, req.params.id, req.body?.on !== false)));
}

module.exports = { mount, directory };
