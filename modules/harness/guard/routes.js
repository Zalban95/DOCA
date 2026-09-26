'use strict';

/**
 * Harness settings → Guards (public/js/settings/guards.js).
 *   GET    /api/harness/guards                  every guard, presets, whether each can run
 *   POST   /api/harness/guards                  add: { preset } | { id, kind, … }
 *   POST   /api/harness/guards/runtime/install  transformers.js into DOCA's data folder (~740 MB)
 *   POST   /api/harness/guards/test             { text } → the verdict, as the airlock would give it
 *   GET    /api/harness/guards/log              what was withheld or flagged, newest first
 *   POST   /api/harness/guards/:id              { enabled?, suspectAt?, blockAt? }
 *   POST   /api/harness/guards/:id/download     the model's files, from Hugging Face
 *   DELETE /api/harness/guards/:id
 * The host right: a guard decides what the agents may read.
 */
const guard = require('./index');
const runtime = require('./runtime');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };

function mount(app) {
  app.get('/api/harness/guards', h(() => guard.status()));
  app.post('/api/harness/guards', h(req => { guard.add(req.body || {}); return guard.status(); }));
  app.post('/api/harness/guards/runtime/install', h(async () => { await runtime.installRuntime(); return guard.status(); }));
  app.post('/api/harness/guards/test', h(req => guard.screen(String(req.body?.text || ''), { direction: 'test', source: 'Guards → Test' })));
  app.get('/api/harness/guards/log', h(req => ({ log: guard.log(Math.min(200, Number(req.query.n) || 50)) })));
  app.post('/api/harness/guards/:id', h(req => { guard.update(req.params.id, req.body || {}); return guard.status(); }));
  app.post('/api/harness/guards/:id/download', h(async req => {
    const g = guard.need(req.params.id);
    if (g.kind !== 'model') throw Object.assign(new Error('Only a model guard has files to download.'), { status: 400 });
    let token = null;
    try { token = require('../../utils').loadModelsPrefs().hf?.token || null; } catch { /* none */ }
    await runtime.downloadModel(g, { token });
    return guard.status();
  }));
  app.delete('/api/harness/guards/:id', h(req => { guard.remove(req.params.id); return guard.status(); }));
}

module.exports = { mount };
