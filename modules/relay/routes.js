'use strict';

/**
 * The model relay's panel routes (relay/index.js), under /api/computers so they are a host's by the rights row that
 * already covers the agents' computers: the owner's card in Field → API keys (on or off, open to whom, which models,
 * where it listens) and one computer's switch (its card in the Computers tab).
 */
const relay = require('./index');
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };

/** Save what was sent of the card, each value checked against its declaration. */
function save(body = {}) {
  const schema = require('../settings-schema');
  const { loadPrefs, savePrefs } = require('../utils');
  const next = { ...(loadPrefs().relay || {}) };
  for (const k of ['enabled', 'computers', 'models', 'port', 'address']) {
    if (body[k] === undefined) continue;
    let v = body[k];
    if (k === 'models' && typeof v === 'string') v = v.split(/[\n,]/);
    if (k === 'models') v = [...new Set(v.map(s => String(s).trim()).filter(Boolean))];
    if (k === 'port') v = Number(v);
    if (k === 'address') v = String(v).trim();
    if (k === 'models' && v.some(s => !/^[^/\s]+\/\S+$/.test(s))) throw bad('Each model is provider/model, e.g. deepseek/deepseek-chat.');
    if (k === 'address' && v && (require('../listen').isTailnet(v) || !(require('../listen').isLoopback(v) || require('../listen').isPrivate(v))))
      throw bad('The relay listens on the Docker bridge or loopback only — never the tailnet or a public address.');
    if (!(k === 'address' && v === '') && !(k === 'models' && !v.length) && !schema.valid(schema.leaf(`relay.${k}`), v)) throw bad(`relay.${k}: ${schema.leaf(`relay.${k}`).hint}`);
    next[k] = v;
  }
  if (body.devices === true) throw bad(relay.state().devicesNote, 409);
  savePrefs({ ...loadPrefs(), relay: next });
}

function mount(app) {
  app.get('/api/computers/relay', h(() => relay.state()));
  app.post('/api/computers/relay', h(async req => { save(req.body || {}); return relay.sync(); }));
  app.post('/api/computers/:id/relay', h(req => require('./computer').set(req.params.id, req.body?.on !== false)));
}

module.exports = { mount, save };
