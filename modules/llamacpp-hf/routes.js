'use strict';

/**
 * Field → Models → llama.cpp → From Hugging Face (all a host's: /api/models/* in auth/rights.js).
 *
 *   GET  /api/models/llamacpp/hf/search?q=     GGUF repositories matching words
 *   GET  /api/models/llamacpp/hf/files?repo=   what one offers: each quantization with its size and whether it fits here
 *   POST /api/models/llamacpp/hf/install       {id: "org/repo:Q4_K_M", vision?, …Advanced} — SSE (install.js)
 */
const hub = require('./hub');

const h = fn => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};

function mount(app) {
  app.get('/api/models/llamacpp/hf/search', h(async req => ({ results: await hub.search(req.query.q) })));
  app.get('/api/models/llamacpp/hf/files', h(async req => {
    const o = await hub.offer(String(req.query.repo || '').trim());
    const a = await require('../guided/assess').assess().catch(() => ({}));
    const { hint } = require('./defaults');
    const proj = o.mmproj.find(f => /[-_]F16\.gguf$/i.test(f.path)) || o.mmproj.find(f => /BF16/i.test(f.path)) || o.mmproj[0] || null;
    return { ...o, folder: require('./install').modelsDir(), llamaServer: !!a.runtimes?.llamacpp, machine: a.summary || null,
      quants: o.quants.map(q => ({ quant: q.quant, file: q.file, parts: q.parts, bytes: q.bytes, fit: hint(q.bytes + (proj?.size || 0), a) })),
      mmproj: proj ? { file: proj.path, bytes: proj.size } : null };
  }));
  app.post('/api/models/llamacpp/hf/install', require('./install').handleInstall);
}

module.exports = { mount };
