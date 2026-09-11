'use strict';

/**
 * HTTP surface for MCP servers: the registry, their lifecycle, and writing
 * them into the config files other agents read.
 */
const registry = require('./registry');
const exporter = require('./export');

/** Turn a thrown error with a `status` into that status, anything else into 500. */
function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  };
}

/** GET /api/mcp — every server, with live state and tools */
const handleList = wrap(async (_req, res) => {
  res.json({ servers: registry.list(), targets: exporter.describeTargets() });
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

module.exports = { handleList, handleUpsert, handleRemove, handleAction, handleLog, handleExport };
