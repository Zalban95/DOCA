'use strict';

/**
 * Settings → Harness → Retrieval: which embedding model (`retrieval.provider` / `.model`), what the index holds,
 * a try against memory, and emptying the index (it is rebuilt on the next search). The switch itself is
 * Settings → Experiments (`experiments.retrieval`).
 */
const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };

function view() {
  const E = require('./embed');
  return Promise.resolve(require('./index').stats()).then(index => ({ ...E.settings(), experiment: require('../experiments').on('retrieval'), on: require('./index').on(), index }));
}

function mount(app) {
  app.get('/api/retrieval', h(view));
  app.post('/api/retrieval', h(async req => {
    const b = req.body || {};
    const { loadPrefs, savePrefs } = require('../utils');
    const prefs = loadPrefs();
    const next = { ...(prefs.retrieval || {}) };
    for (const k of ['provider', 'model']) if (typeof b[k] === 'string') {
      if (b[k] && !/^[\w.:/@-]{1,120}$/.test(b[k].trim())) throw Object.assign(new Error(`${k} is a name: letters, digits and . : / @ - _`), { status: 400 });
      next[k] = b[k].trim();
    }
    savePrefs({ ...prefs, retrieval: next });
    return view();
  }));
  app.post('/api/retrieval/try', h(async req => {
    const query = String(req.body?.query || '').trim();
    if (!query) throw Object.assign(new Error('Say what to look for.'), { status: 400 });
    const t0 = Date.now();
    const mem = require('../harness/memory');
    const items = mem.memList().map(e => ({ ref: e.key, text: `${e.key}: ${e.value}` }));
    const hits = await require('./index').search('memory', query, items, { limit: 5 });
    return { ms: Date.now() - t0, hits: hits.map(x => ({ ref: x.ref, score: Math.round(x.score * 1000) / 1000 })) };
  }));
  app.delete('/api/retrieval/index', h(async () => { await require('./index').clear(); return view(); }));
}

module.exports = { mount };
