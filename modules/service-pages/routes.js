'use strict';

/**
 *   GET    /api/service-pages             the pages this person sees now: answering services only (signed)
 *   POST   /api/service-pages/:id/open    a pass for this person's frame: the canvas origin's /s/<id>/ address (signed)
 *   GET    /api/service-pages/all         every service with its health, for Field → Connectors (host)
 *   POST   /api/service-pages             add or change one; its health asked at once (host)
 *   DELETE /api/service-pages/:id         (host)
 */
const services = require('./index');
const health = require('./health');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const person = req => ({ id: req.auth?.user?.id || null, role: req.auth?.role || null, orgId: req.auth?.orgId || null });

/** The canvas origin as this browser reaches it: the panel's own host, the canvas port. */
function canvasOrigin(req) {
  const { CANVAS_PORT } = require('../paths');
  const host = String(req.headers.host || 'localhost').replace(/:\d+$/, '');
  return `https://${host}:${CANVAS_PORT}`;
}

function mount(app) {
  app.get('/api/service-pages', h(req => ({ pages: services.all().filter(s => services.sees(s, person(req)) && health.of(s.id).up)
    .map(s => ({ id: s.id, name: s.name, group: s.group, icon: s.icon || null })) })));
  app.post('/api/service-pages/:id/open', h(req => {
    const s = services.get(req.params.id), p = person(req);
    if (!s || !services.sees(s, p)) throw Object.assign(new Error('No such service here.'), { status: 404 });
    if (!health.of(s.id).up) throw Object.assign(new Error(`${s.name} is not answering now.`), { status: 503 });
    const token = require('./tokens').make(s.id, p);
    return { url: `${canvasOrigin(req)}/s/${s.id}/?doca_t=${token}`, name: s.name };
  }));
  app.get('/api/service-pages/all', h(() => ({ services: services.all().map(s => ({ ...s, health: s.health, state: health.of(s.id), pid: require('./run').running(s.id) })), groups: services.GROUPS })));
  app.post('/api/service-pages', h(async req => {
    const s = services.save(req.body || {});
    const state = await health.check(s);
    require('../activity').note({ from: 'services', what: `${s.name} was set up as a page (${state.up ? 'answering' : `not answering: ${state.why}`})`, why: 'an admin',
      person: { id: req.auth?.user?.id || null, name: req.auth?.user?.name || req.auth?.user?.email || null } });
    try { require('../live').changed('screen', null, 'services', { id: s.id, up: state.up }); } catch { /* bookkeeping */ }
    return { service: s, state };
  }));
  // Starting its program here, and with DOCA (run.js): a host's, like starting an MCP server.
  const svc = req => { const s = services.get(req.params.id); if (!s) throw Object.assign(new Error('No such service.'), { status: 404 }); return s; };
  const after = async s => { await new Promise(r => setTimeout(r, 1500)); return { state: await health.check(s), pid: require('./run').running(s.id) }; };
  app.post('/api/service-pages/:id/boot', h(req => ({ service: services.patch(req.params.id, { boot: req.body?.on === true }) })));
  app.post('/api/service-pages/:id/start', h(async req => { const s = svc(req); const r = require('./run').start(s); return { ...r, ...(await after(s)) }; }));
  app.post('/api/service-pages/:id/stop', h(async req => { const s = svc(req); const r = require('./run').stop(s); return { ...r, ...(await after(s)) }; }));
  app.get('/api/service-pages/:id/log', h(req => ({ log: require('./run').tail(svc(req).id) })));
  app.delete('/api/service-pages/:id', h(req => {
    const r = services.remove(req.params.id);
    health._state.delete(req.params.id);
    try { require('../live').changed('screen', null, 'services', { id: req.params.id, up: false }); } catch { /* bookkeeping */ }
    return r;
  }));
}

module.exports = { mount };
