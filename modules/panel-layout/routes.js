'use strict';

/**
 * The panel's layout for the screen asking (panel-layout/index.js): `GET /api/screen/layout` is each layer, what they
 * resolve to and how many steps each can undo; `POST /api/screen/layout {scope, ops | layout}` changes the person's
 * own layer or this screen's (any signed-in person: it is how their panel looks), or the install's default (a host's);
 * `POST /api/screen/layout/undo {scope}` puts back what the last change replaced.
 */
const layout = require('./index');

const hostOf = req => require('../auth/rights').can(req.auth?.role, 'host');

function who(req, res) {
  const d = require('../screens').ensure(req, res, req.query.device || null);
  return { userId: req.auth.user.id, deviceId: d.id, device: d };
}

function scopeOf(req) {
  const scope = String(req.body?.scope || 'person');
  if (!layout.SCOPES.includes(scope)) throw Object.assign(new Error(`scope is ${layout.SCOPES.join(', ')}.`), { status: 400 });
  if (scope === 'install' && !hostOf(req)) throw Object.assign(new Error('The install\'s default layout is an admin\'s; yours and this screen\'s are yours.'), { status: 403 });
  return scope;
}

function view(req, w) {
  const host = hostOf(req), e = layout.effective(w, { host });
  return {
    screen: { id: w.device.id, name: w.device.name }, host,
    layers: e.layers, resolved: e.resolved,
    lines: Object.fromEntries(layout.SCOPES.map(s => [s, layout.describe(e.layers[s], e.resolved.labels)])),
    undo: Object.fromEntries(layout.SCOPES.filter(s => s !== 'install' || host).map(s => [s, layout.undoable(s, w)])),
  };
}

const wrap = fn => (req, res) => { try { fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };

function mount(app) {
  app.get('/api/screen/layout', wrap((req, res) => res.json(view(req, who(req, res)))));
  app.post('/api/screen/layout', wrap((req, res) => {
    const w = who(req, res), scope = scopeOf(req);
    let said = [];
    if (Array.isArray(req.body?.ops)) said = layout.change(scope, w, req.body.ops, { host: hostOf(req) }).said;
    else if (req.body?.layout && typeof req.body.layout === 'object') { layout.write(scope, w, req.body.layout); said = ['replaced']; }
    else throw Object.assign(new Error('Send ops (steps) or a layout.'), { status: 400 });
    res.json({ said, ...view(req, w) });
  }));
  app.post('/api/screen/layout/undo', wrap((req, res) => {
    const w = who(req, res);
    layout.undo(scopeOf(req), w);
    res.json(view(req, w));
  }));
}

module.exports = { mount };
