'use strict';

/**
 * /api/projects/:id/params — a project's parameters for the mask (Projects → Parameters), its build and its checks.
 * Reading is anyone who may see the project; saving and building, who may work on it (projects/access.js). The same
 * modules serve the agent's `project_params` and a device's /api/v1/projects (api-v1/projects.js).
 *
 *   GET  …/params           the declarations with their values, the file's hash, the build's state and proof
 *   POST …/params           {values, ifMatch, acceptBuild?} save and build (409 stale | build_changed, with what changed)
 *   GET  …/params/build     where the build is
 *   POST …/params/build     {acceptBuild?} build the values as they are
 *   GET  …/params/check     the checks: built from the current values, and values typed twice into the templates
 */
const path = require('path');
const file = require('./file');

/** What the mask (and a device) reads. */
function read(p, person) {
  const f = file.read(p.root);
  const access = require('../projects/access');
  const out = { exists: f.exists, file: file.NAME, hash: f.hash || null, errors: f.errors || [], yours: access.rightOn(person, p), mayWork: access.mayWork(person, p) };
  if (!f.doc) return out;
  const fp = require('./stamp').fingerprint(p.root, f.doc);
  return { ...out, ...file.view(f.doc), stages: (f.doc.build || []).map(s => ({ id: s?.id, recipe: s?.recipe })),
    build: require('./build').status(p), buildChanged: require('./stamp').changedFor(person, p.id, p.root, fp) };
}

/** The checks over a project: its stamp, and every stage template for values typed twice. */
async function checks(p) {
  const f = file.read(p.root);
  if (!f.doc) return { checks: [] };
  const run = require('../checks').run;
  const out = [{ check: 'built', ...(await run({ built: file.where(p.root) }, { cwd: p.root })) }];
  for (const st of f.doc.build || []) if (typeof st?.template === 'string') out.push({ check: 'literals', file: st.template, ...(await run({ literals: path.resolve(p.root, st.template) }, { cwd: p.root })) });
  return { checks: out };
}

/** An error with what the panel needs to show it (the diff of a changed build, the values now). */
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.change ? { change: e.change } : {}), ...(e.values ? { values: e.values, hash: e.hash } : {}) });

function mount(app, { P, who }) {
  const h = fn => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { fail(res, e); } };
  const client = req => require('../harness/turn/client').dashboardClient(req);
  app.get('/api/projects/:id/params', h(req => read(P(req), who(req))));
  app.post('/api/projects/:id/params', h(async req => {
    const p = P(req, { work: true });
    const r = await require('./save').save(p, { values: req.body?.values || {}, ifMatch: req.body?.ifMatch || null, person: who(req), client: client(req), acceptBuild: req.body?.acceptBuild === true });
    return { ...r, params: read(p, who(req)) };
  }));
  app.get('/api/projects/:id/params/build', h(req => require('./build').status(P(req))));
  app.post('/api/projects/:id/params/build', h(req => {
    const p = P(req, { work: true });
    const st = require('./build').start(p, { person: who(req), client: client(req), acceptBuild: req.body?.acceptBuild === true });
    return { build: { ...st, promise: undefined } };
  }));
  app.get('/api/projects/:id/params/check', h(req => checks(P(req))));
}

module.exports = { mount, read, checks };
