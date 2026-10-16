'use strict';

/**
 * A person's projects for their devices (owner, 2026-10-16: "every device inherits its user's rights" — the project
 * mask over /api/v1 included). A device acts as its person: it sees the projects that person owns or was shared, reads
 * their parameters, and — where the person may work on the project — saves values and builds, exactly as the panel's
 * Projects → Parameters does (params/). No scope of its own: reading is harness:sessions, acting harness:chat, the
 * scopes a device already holds to read and talk to its person's conversations, where it could ask for the same build.
 *
 *   GET  /projects                       harness:sessions  the person's projects, with what they hold on each
 *   GET  /projects/:id/params            harness:sessions  the declarations, values, the build's state and proof
 *   POST /projects/:id/params            harness:chat      {values, ifMatch?, acceptBuild?}: save and build
 *   POST /projects/:id/params/build      harness:chat      {acceptBuild?}: build the values as they are
 * Saving and building are a person's decision: a device of kind `agent` reads only.
 */
const { can } = require('./auth');
const { sendError } = require('./errors');

const need = (req, res, scope) => { if (can(req, scope)) return true; sendError(res, 403, 'scope_required', `This action requires ${scope}`, { required: [scope] }); return false; };
const who = req => require('../harness/turn/client').deviceOwner(require('./devices').get(req.device.id));
const CODES = { 400: 'invalid_request', 403: 'forbidden', 404: 'not_found', 409: 'conflict' };
const fail = (res, e) => sendError(res, e.status || 500, e.code || CODES[e.status] || 'error', e.message, { ...(e.change ? { change: e.change } : {}), ...(e.values ? { values: e.values, hash: e.hash } : {}) });
const access = () => require('../projects/access');
const client = req => { const d = require('./devices').get(req.device.id); return { name: d.name, kind: d.kind, user: who(req) }; };

function mount(router) {
  router.get('/projects', (req, res) => {
    if (!need(req, res, 'harness:sessions')) return;
    const person = who(req);
    res.json({ projects: access().visible(person, require('../projects/store').list()).filter(p => !p.archivedAt)
      .map(p => ({ id: p.id, name: p.name, yours: access().rightOn(person, p), params: require('../params/file').read(p.root).exists })) });
  });
  router.get('/projects/:id/params', (req, res) => {
    if (!need(req, res, 'harness:sessions')) return;
    try { const p = access().need(who(req), req.params.id); res.json(require('../params/routes').read(p, who(req))); } catch (e) { fail(res, e); }
  });
  const acting = (req, res) => {
    if (!need(req, res, 'harness:chat')) return false;
    if (req.device.kind === 'agent') { sendError(res, 403, 'person_only', 'Saving a project\'s values and building it is a person\'s decision; an agent reads them.'); return false; }
    return true;
  };
  router.post('/projects/:id/params', async (req, res) => {
    if (!acting(req, res)) return;
    try {
      const p = access().need(who(req), req.params.id, { work: true });
      const r = await require('../params/save').save(p, { values: req.body?.values || {}, ifMatch: req.body?.ifMatch || null, person: who(req), client: client(req), acceptBuild: req.body?.acceptBuild === true });
      res.json({ changes: r.changes, hash: r.hash, commit: r.commit || null, build: r.build || null });
    } catch (e) { fail(res, e); }
  });
  router.post('/projects/:id/params/build', (req, res) => {
    if (!acting(req, res)) return;
    try {
      const p = access().need(who(req), req.params.id, { work: true });
      const st = require('../params/build').start(p, { person: who(req), client: client(req), acceptBuild: req.body?.acceptBuild === true });
      res.json({ build: { ...st, promise: undefined } });
    } catch (e) { fail(res, e); }
  });
}

module.exports = { mount };
