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

module.exports = { mount };
