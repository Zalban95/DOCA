'use strict';

/**
 * Packs in the panel (TODO H4): what can go in one, building and downloading one, and bringing one in — a dry
 * run first, then only what was chosen. Host only: a pack can carry MCP commands this host would spawn,
 * specialists' tool lists and memory, each of which already needs host here.
 */
const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const upload = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }).single('file');
const file = req => { if (!req.file?.buffer) throw Object.assign(new Error('Send the pack as "file".'), { status: 400 }); return req.file.buffer; };

function mount(app) {
  app.get('/api/packs/contents', h(() => ({
    skills: require('../harness/skills').list().map(s => ({ id: s.name, label: s.description, source: s.source })),
    specialists: require('../agents/registry').list().filter(a => !a.broken).map(a => ({ id: a.id, label: a.label })),
    recipes: require('../recipes/store').list().map(r => ({ id: r.id, label: r.title })),
    mcp: require('../mcp/registry').load().filter(s => s.origin?.kind !== 'client').map(s => ({ id: s.id, label: s.label })),
    levels: require('../auth/levels').list().filter(l => !l.builtin).map(l => ({ id: l.id, label: l.name })),   // for an edition (edition.js)
  })));
  app.post('/api/packs/export', async (req, res) => {
    try {
      const { manifest, buffer } = require('./export').build(req.body || {});
      const name = `${String(manifest.name).replace(/[^\w.-]+/g, '-') || 'pack'}.dpack`;
      res.set('Content-Disposition', `attachment; filename="${name}"`).type('application/zip').send(buffer);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/packs/plan', upload, h(req => require('./import').plan(file(req))));
  // The library (library.js): what this hive keeps — made here, by the agent, or received — and other hubs to send to (send.js).
  const lib = () => require('./library');
  app.get('/api/packs/library', h(() => ({ packs: lib().list(), hubs: require('./send').list(), registry: require('../experiments').on('packRegistry') })));
  app.post('/api/packs/library', h(req => lib().save(require('./export').build(req.body || {}).buffer, { origin: 'made', from: req.auth?.user?.name || req.auth?.user?.email || null })));
  app.get('/api/packs/library/:id', (req, res) => {
    try { const { meta, buffer } = lib().get(req.params.id); res.set('Content-Disposition', `attachment; filename="${meta.name.replace(/[^\w.-]+/g, '-') || 'pack'}.dpack"`).type('application/zip').send(buffer); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.delete('/api/packs/library/:id', h(req => lib().remove(req.params.id)));
  app.post('/api/packs/library/:id/plan', h(req => require('./import').plan(lib().get(req.params.id).buffer)));
  app.post('/api/packs/library/:id/import', h(req => require('./import').apply(lib().get(req.params.id).buffer, { only: Array.isArray(req.body?.only) ? req.body.only : null,
    overwrite: req.body?.overwrite === true, person: require('../harness/turn/client').dashboardClient(req).user, actorLevel: req.auth?.role || null })));
  app.post('/api/packs/library/:id/send', h(req => require('./send').send(String(req.body?.hub || ''), req.params.id)));
  app.post('/api/packs/hubs', h(req => require('./send').add(req.body || {})));
  // The registry (experiments.packRegistry): publishing from this library, browsing and fetching from another hub's.
  const reg = () => { if (!require('../experiments').on('packRegistry')) throw Object.assign(new Error('The pack registry is an experiment that is off (Settings → Experiments).'), { status: 409 }); };
  app.post('/api/packs/library/:id/publish', h(req => { reg(); return lib().publish(req.params.id, req.body?.on !== false); }));
  app.get('/api/packs/hubs/:id/published', h(req => { reg(); return require('./send').browse(req.params.id); }));
  app.post('/api/packs/hubs/:id/fetch', h(req => { reg(); return require('./send').fetchPack(req.params.id, String(req.body?.pack || '')); }));
  app.delete('/api/packs/hubs/:id', h(req => require('./send').remove(req.params.id)));
  app.post('/api/packs/import', upload, h(req => {
    let only = null;
    try { only = req.body?.only ? JSON.parse(req.body.only) : null; } catch { throw Object.assign(new Error('only is a JSON list of keys from the plan.'), { status: 400 }); }
    return require('./import').apply(file(req), { only, overwrite: req.body?.overwrite === 'true' || req.body?.overwrite === true,
      person: require('../harness/turn/client').dashboardClient(req).user, actorLevel: req.auth?.role || null });
  }));
}

module.exports = { mount };
