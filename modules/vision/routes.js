'use strict';

/**
 * The readers' settings (modules/vision): GET /api/vision says which are set up here and how (the key masked),
 * POST /api/vision sets them (a host's), POST /api/vision/try reads a picture with one (a host's: it spends a model
 * call). Settings → Harness → Vision.
 */
const vision = require('./index');
const KEYS = { backend: /^(model|detector|text|template)$/, provider: /^[\w.-]{0,60}$/, model: /^[\w.:/@-]{0,120}$/,
  detectorUrl: /^(https?:\/\/\S{3,300})?$/, detectorModel: /^[\w.-]{0,80}(\/\d{1,4})?$/, apiKey: /^[\w-]{0,80}$/, ocrLang: /^[a-z_+]{2,60}$/ };
const { MASK } = require('../secrets-mask');

const view = async () => {
  const s = vision.settings();
  return { settings: { ...s, apiKey: s.apiKey ? MASK : '' }, available: await vision.available(),
    experiment: require('../experiments').on('visionPass'), readers: Object.fromEntries(Object.entries(vision.BACKENDS).map(([id, b]) => [id, b.label])) };
};

function mount(app) {
  app.get('/api/vision', async (_req, res) => res.json(await view()));
  app.post('/api/vision', async (req, res) => {
    const b = req.body || {}, { loadPrefs, savePrefs } = require('../utils');
    const prefs = loadPrefs(), next = { ...(prefs.vision || {}) };
    for (const [k, re] of Object.entries(KEYS)) if (typeof b[k] === 'string' && !(k === 'apiKey' && b[k] === MASK)) {
      if (!re.test(b[k].trim())) return res.status(400).json({ error: `${k}: not a value this takes.` });
      next[k] = b[k].trim();
    }
    savePrefs({ ...prefs, vision: next });
    res.json(await view());
  });
  app.post('/api/vision/try', async (req, res) => {
    try {
      const png = Buffer.from(String(req.body?.png || ''), 'base64');
      if (png.length < 8) return res.status(400).json({ error: 'Send a PNG (base64) to read.' });
      const t0 = Date.now(), r = await vision.read(png, req.body?.question || '', { how: req.body?.how || 'auto' });
      res.json({ ms: Date.now() - t0, answer: vision.say(r) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { mount };
