'use strict';

/** Settings → Harness → Web search (modules/search): the provider, the SearXNG address, the keys, and a try. Host only. */
const search = require('./index');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };

function mount(app) {
  app.get('/api/search/settings', h(() => search.status()));
  app.post('/api/search/settings', h(req => {
    const { provider, url, keys = {} } = req.body || {};
    const { loadPrefs, savePrefs } = require('../utils');
    const prefs = loadPrefs();
    if (provider !== undefined && !search.PROVIDERS.includes(provider)) throw Object.assign(new Error(`provider is one of ${search.PROVIDERS.join(', ')}`), { status: 400 });
    savePrefs({ ...prefs, search: { ...(prefs.search || {}), ...(provider !== undefined ? { provider } : {}), ...(url !== undefined ? { url: String(url).trim() } : {}) } });
    for (const [name, key] of Object.entries(keys)) if (typeof key === 'string' && key !== require('../secrets-mask').MASK) search.setKey(name, key);
    return search.status();
  }));
  app.post('/api/search/try', h(req => search.search(req.body?.query || 'DOCA agent harness', { count: 5 })));
}

module.exports = { mount };
