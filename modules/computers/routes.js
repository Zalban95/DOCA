'use strict';

/** Computers for agents (./index.js): the panel's list, building the image, and each one's lifecycle. Host only. */
const computers = require('./index');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };

function mount(app) {
  app.get('/api/computers', h(async () => ({ computers: await computers.detailed(), image: await computers.imageState() })));
  app.post('/api/computers/image', async (req, res) => {
    const { sseHeaders } = require('../utils');
    sseHeaders(res);
    const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };
    try { await computers.build(line => send({ status: `${line}\n` })); send({ done: true, ok: true, status: '\n✓ Built.\n' }); }
    catch (e) { send({ done: true, ok: false, status: `\n✗ ${e.message}\n` }); }
    res.end();
  });
  app.post('/api/computers', h(req => computers.create({ ...(req.body || {}), by: req.auth?.user?.id || null })));
  // Containers no record names (strays.js): listed for a person to archive or delete, and what the tidy-up does with them.
  const strays = require('./strays');
  app.get('/api/computers/strays', h(async () => ({ strays: await strays.list(), policy: require('../settings-schema').value('computers.strays'), choices: strays.POLICIES })));
  app.post('/api/computers/strays/policy', h(req => strays.setPolicy(req.body?.strays)));
  app.post('/api/computers/strays/:name/archive', h(req => strays.adopt(req.params.name)));
  app.delete('/api/computers/strays/:name', h(req => strays.discard(req.params.name, { volume: req.query.volume === '1' })));
  app.get('/api/computers/:id/screen', async (req, res) => {   // a still for the view's thumbnails (index.js screen)
    try { res.set('Cache-Control', 'no-store').type('png').send(await computers.screen(req.params.id)); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/computers/:id/start', h(req => computers.start(req.params.id)));
  app.post('/api/computers/:id/stop', h(req => computers.stop(req.params.id)));
  // Marking a test computer loosens its browser guard: a person's, with the password (auth/guarded.js) — never the agent's.
  app.post('/api/computers/:id/test', h(req => require('./test-mode').mark(req.params.id, req.body?.on !== false)));
  app.post('/api/computers/:id/pin', h(req => computers.pin(req.params.id, req.body?.pinned !== false)));   // a person's call, never the agent's
  app.delete('/api/computers/:id', h(req => computers.remove(req.params.id)));
  app.post('/api/computers/:id/put', h(req => computers.put(req.params.id, req.body?.attachment, req.body?.path)));   // an attachment into it
  app.post('/api/computers/:id/get', h(req => computers.fetchFile(req.params.id, req.body?.path)));                  // a file out of it, kept
  app.get('/computers/:id/vnc/*', require('./vnc').page);   // its screen, through the hub (vnc.js)
}

module.exports = { mount };
