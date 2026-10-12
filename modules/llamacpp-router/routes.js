'use strict';

/**
 * A llama.cpp router's models, set from Field → Models (preset.js):
 *   GET  /api/models/llamacpp/router   the preset file's sections and the keys the form changes, with the router's address
 *   POST /api/models/llamacpp/router   {section, values} — saved (the old file kept beside it), the router told to read it
 *                                       again, and the model unloaded when it is loaded and idle, so its next load is the new one
 * Both are a host's (the /api/models rows): a preset is this machine's model server.
 */
const preset = require('./preset');

/** The router answering on this machine: its origin, and its models' states. */
async function router() {
  const s = (await require('../model-servers').status()).servers.find(x => x.kind === 'llama.cpp router');
  if (!s) return null;
  try { return { origin: new URL(s.url).origin, url: s.url, models: s.models }; } catch { return null; }
}

function mount(app) {
  app.get('/api/models/llamacpp/router', async (_req, res) => {
    try { res.json({ ...preset.read(), router: await router() }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/models/llamacpp/router', async (req, res) => {
    try {
      const { section, values } = req.body || {};
      if (!section || typeof values !== 'object') return res.status(400).json({ error: 'Send {section, values}.' });
      const r = preset.save(String(section), values);
      const said = [];
      const rt = r.changed ? await router() : null;
      if (rt) {
        const reload = await fetch(`${rt.origin}/models/reload`, { method: 'POST', signal: AbortSignal.timeout(10000) }).catch(() => null);
        said.push(reload?.ok ? 'The router read the file again.' : 'The router did not take the file back on its own: restart it to use the change.');
        const m = rt.models.find(x => x.id === section);
        if (m && m.state === 'loaded') {
          const un = await fetch(`${rt.origin}/models/unload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: section }), signal: AbortSignal.timeout(10000) }).catch(() => null);
          if (un?.ok) said.push(`${section} was unloaded: its next request loads it with the new settings.`);
        } else if (m && m.state === 'working') said.push(`${section} is answering now: the new settings apply from its next load.`);
      }
      // Another function may lean on this model with a window of its own (the harness's fallback chain): a new context
      // here is said there, so the fallback is not left believing the old one (asked 2026-10-12).
      if (r.changed && values['ctx-size']) {
        const chain = require('../harness/catalog').configFor('doca')?.fallbackChain || [];
        chain.forEach((c, i) => {
          if (c?.model === section && Number(c.contextWindow) !== Number(values['ctx-size']))
            said.push(`The harness's fallback ${i + 1} uses ${section} with a window of ${Number(c.contextWindow) ? Number(c.contextWindow).toLocaleString() : 'none declared'}: Controls → DOCA ⚙ → Fallback offers ${Number(values['ctx-size']).toLocaleString()}.`);
        });
      }
      require('../activity').note({ from: 'llama.cpp', what: r.changed ? `changed the router's ${section}: ${Object.keys(values).join(', ')}` : `left the router's ${section} as it was`,
        why: 'a host saved it in Field → Models', machine: { kind: 'llamacpp', id: `router:${section}`, name: section }, act: 'configure' });
      res.json({ ...r, said, ...preset.read(r.file) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { mount, router };
