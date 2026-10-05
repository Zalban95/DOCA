'use strict';

/**
 * Another hub sends this one a pack (TODO H4.5): a device token holding `packs:send` (the `hub` preset) may knock
 * (`GET /packs`: who this hub is) and send (`POST /packs`, the .dpack as "file"). It lands in the library marked as
 * received from that device and waits; bringing it in is the dry run and a host's click like any pack. Nothing is
 * applied here.
 */
const { requireScope } = require('./auth');

function mount(router, upload) {
  router.get('/packs', requireScope('packs:send'), (req, res) => {
    const b = require('../branding');
    res.json({ hub: b.name('product'), version: require('../../package.json').version, accepts: 'dpack' });
  });
  router.post('/packs', requireScope('packs:send'), upload.single('file'), (req, res) => {
    if (!req.file?.buffer) return res.status(400).json({ error: { code: 'invalid_request', message: 'Send the pack as "file".' } });
    try {
      const meta = require('../packs/library').save(req.file.buffer, { origin: 'received', from: req.device?.name || req.device?.id });
      res.status(201).json({ received: meta.id, name: meta.name, note: 'In the library; a host brings it in from Settings → Packs.' });
    } catch (e) { res.status(e.status || 500).json({ error: { code: 'invalid_request', message: e.message } }); }
  });
}

/**
 * The registry side (TODO H4.6, experiments.packRegistry): what this hub publishes, for a hub holding packs:read to
 * browse and fetch. Off (404) unless the experiment is on; only packs a host published are listed or served.
 */
function mountRegistry(router) {
  const on = (req, res, next) => (require('../experiments').on('packRegistry') ? next() : res.status(404).json({ error: { code: 'not_found', message: 'This hub publishes no packs.' } }));
  router.get('/packs/published', requireScope('packs:read'), on, (req, res) => res.json({ hub: require('../branding').name('product'),
    packs: require('../packs/library').published().map(({ id, name, description, contents, bytes, savedAt }) => ({ id, name, description, contents, bytes, savedAt })) }));
  router.get('/packs/published/:id', requireScope('packs:read'), on, (req, res) => {
    try {
      const { meta, buffer } = require('../packs/library').get(req.params.id);
      if (!meta.published) throw Object.assign(new Error('Not published.'), { status: 404 });
      res.type('application/zip').send(buffer);
    } catch (e) { res.status(e.status || 500).json({ error: { code: 'not_found', message: e.message } }); }
  });
}

module.exports = { mount, mountRegistry };
