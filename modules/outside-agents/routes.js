'use strict';

/**
 * Other agents on this machine (index.js): what is found and said, the OpenTelemetry receiver's state and the lines to
 * set in each agent, and the owner's switch. Host (rights.js `/api/workstream…`): it is the machine's own programs.
 */
function mount(app) {
  const oa = require('./index'), life = require('./otel/life');
  const view = async () => {
    const port = Number(require('../settings-schema').value('outsideAgents.otelPort')) || 4318;
    return { ...oa.status(), otel: require('../settings-schema').value('outsideAgents.otel') !== false, port,
      receiver: life.state(), setup: require('./setup').lines(port) };
  };
  app.get('/api/workstream/agents', async (_req, res) => res.json(await view()));
  app.post('/api/workstream/agents', async (req, res) => {
    const b = req.body || {}, { loadPrefs, savePrefs } = require('../utils');
    const next = { ...(loadPrefs().outsideAgents || {}) };
    if (typeof b.enabled === 'boolean') next.enabled = b.enabled;
    if (typeof b.otel === 'boolean') next.otel = b.otel;
    if (b.otelPort != null) {
      const p = Number(b.otelPort);
      if (!Number.isInteger(p) || p < 1024 || p > 65535) return res.status(400).json({ error: 'The port is a whole number from 1024 to 65535.' });
      next.otelPort = p;
    }
    if (next.enabled && !oa.enabled() && !require('../license').featureOn('outside-agents')) return res.status(403).json({ error: 'Not licensed on this hub.' });
    savePrefs({ ...loadPrefs(), outsideAgents: next });
    if (!oa.enabled()) oa.stop();
    else if (require('../workstream').holding()) await oa.start();
    await life.sync();
    res.json(await view());
  });
}

module.exports = { mount };
