'use strict';

/**
 * HTTP surface for MCP servers: the registry, their lifecycle, and writing
 * them into the config files other agents read.
 */
const registry = require('./registry');
const exporter = require('./export');
const offers   = require('./offers');

/** Turn a thrown error with a `status` into that status, anything else into 500. */
function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  };
}

/** GET /api/mcp — every server, with live state and tools, plus anything a client is offering */
const handleList = wrap(async (_req, res) => {
  res.json({ servers: registry.list(), targets: exporter.describeTargets(), offers: offers.list().pending });
});

/** POST /api/mcp/offers/:id/accept — the click that turns an offer into a definition */
const handleOfferAccept = wrap(async (req, res) => {
  res.json({ ok: true, ...offers.accept(req.params.id) });
});

/** POST /api/mcp/offers/:id/reject */
const handleOfferReject = wrap(async (req, res) => {
  res.json({ ok: true, offer: offers.reject(req.params.id, req.body?.reason) });
});

/** POST /api/mcp — create or update a definition */
const handleUpsert = wrap(async (req, res) => {
  res.json({ ok: true, server: registry.upsert(req.body || {}) });
});

/** DELETE /api/mcp/:id */
const handleRemove = wrap(async (req, res) => {
  registry.remove(req.params.id);
  res.json({ ok: true });
});

/** POST /api/mcp/:id/action — { action: start | stop | restart | refresh } */
const handleAction = wrap(async (req, res) => {
  const { id } = req.params;
  const action = req.body?.action;

  // Checked up front so "there is no such server" stays a 404, rather than
  // falling into the branch that reports a server which failed to start.
  const spec = registry.get(id);
  if (!spec) return res.status(404).json({ error: 'Unknown MCP server' });

  if (action === 'stop') {
    registry.stop(id);
    return res.json({ ok: true, server: registry.status(spec) });
  }
  if (action === 'start' || action === 'restart') {
    // A server that cannot start is a normal outcome worth reporting in place —
    // its own log says why — so answer 200 with the failed state, not a 500.
    try { await (action === 'start' ? registry.start(id) : registry.restart(id)); }
    catch (e) { return res.json({ ok: false, error: e.message, server: registry.status(registry.get(id)) }); }
    return res.json({ ok: true, server: registry.status(registry.get(id)) });
  }
  // Asking the *client* to bring its own listener up or down. Nothing local
  // happens: DOCA has no handle on a process it did not spawn, so all "Start" on
  // a client row could ever do before this was open a socket and hope. The
  // client may refuse — its consent switch outranks this — so the honest answer
  // is "asked", never "started".
  if (action === 'listener-start' || action === 'listener-stop') {
    if (spec.origin?.kind !== 'client')
      return res.status(400).json({ error: 'That server runs on this host — start it here instead of asking a client to' });
    const deviceId = spec.origin.deviceId;
    const bus = require('../api-v1/bus');
    const devices = require('../api-v1/devices');
    const dev = devices.get(deviceId);
    if (!dev || dev.revokedAt)
      return res.status(409).json({ error: `The device that hosts it (${deviceId}) is no longer paired` });
    bus.publish(deviceId, 'mcp.listener', {
      action: action === 'listener-start' ? 'start' : 'stop',
      serverId: spec.id, url: spec.url, by: 'dashboard',
    });
    // Queued for a client that is not connected: the event is durable for five
    // minutes, so say so rather than implying it landed.
    const online = bus.isOnline(deviceId);
    return res.json({
      ok: true, asked: true, online,
      message: online
        ? `Asked ${dev.name} to ${action === 'listener-start' ? 'start' : 'stop'} its MCP server`
        : `${dev.name} is not connected — the request is queued for 5 minutes`,
      server: registry.status(spec),
    });
  }

  if (action === 'refresh') {
    const c = registry.client(id);
    if (c?.state !== 'running') return res.status(409).json({ error: 'That server is not running' });
    await c.listTools();
    return res.json({ ok: true, server: registry.status(registry.get(id)) });
  }
  res.status(400).json({ error: `Unknown action "${action}"` });
});

/** GET /api/mcp/:id/log — the server's stderr, which is where MCP servers talk */
const handleLog = wrap(async (req, res) => {
  const c = registry.client(req.params.id);
  res.json({ log: c ? c.log.join('\n') : '', state: c?.state || 'stopped' });
});

/** POST /api/mcp/export — { target, ids? } writes the config another agent reads */
const handleExport = wrap(async (req, res) => {
  res.json(await exporter.write(req.body?.target, req.body?.ids));
});

function mount(app) {
  app.get   ('/api/mcp',             handleList);
  app.post  ('/api/mcp',             handleUpsert);
  app.post  ('/api/mcp/export',      handleExport);
  // Before /:id, or "offers" is read as a server id.
  app.post  ('/api/mcp/offers/:id/accept', handleOfferAccept);
  app.post  ('/api/mcp/offers/:id/reject', handleOfferReject);
  app.get   ('/api/mcp/:id/log',     handleLog);
  app.post  ('/api/mcp/:id/action',  handleAction);
  app.delete('/api/mcp/:id',         handleRemove);
}

module.exports = {
  mount,
  handleList, handleUpsert, handleRemove, handleAction, handleLog, handleExport,
  handleOfferAccept, handleOfferReject,
};
