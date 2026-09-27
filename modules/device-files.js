'use strict';

/**
 * A paired device's files, in the Files tab and the tree — the same routes and
 * shapes as the host's (/api/files/*), under /api/devices/:id/files/*, each
 * carried out by the device's own `files_*` tools on the MCP server it hosts
 * (PROTOCOL §22.1; docs/design/devices-as-hands.md §5).
 *
 * Only when the device has granted `files` and DOCA has not revoked it, and only
 * while its server is running. The device decides what its person allowed; DOCA
 * never reaches a device's disk any other way.
 *
 * Tools the device offers (JSON in, JSON text out):
 *   files_list   { path }                 → { path, entries: [{ name, isDir, size, mtime }] }
 *   files_read   { path, encoding? }      → { content, size, mtime }   (encoding "base64" for binary)
 *   files_write  { path, content, encoding? } → { ok }
 *   files_mkdir  { path }                 → { ok }
 *   files_move   { from, to }             → { ok }
 *   files_copy   { from, to }             → { ok }
 *   files_delete { paths: [] }            → { ok }
 */
const path = require('path');

const bad = (m, status = 400) => Object.assign(new Error(m), { status });

/** The device's running MCP server and its tools, if its files family may be used. */
function reach(deviceId) {
  const devices = require('./api-v1/devices');
  const d = devices.get(deviceId);
  if (!d || d.revokedAt) throw bad('No such paired device.', 404);
  const st = require('./devices-control').state(deviceId);
  if (!st.usable.includes('files')) throw bad(`${d.name} has not granted its files${st.revoked.includes('files') ? ' (revoked here)' : ''}.`, 403);
  const registry = require('./mcp/registry');
  const spec = registry.forDevice(deviceId);
  const client = spec && registry.client(spec.id);
  if (!client || client.state !== 'running') throw bad(`${d.name} is not connected: its MCP server is not running.`, 503);
  return { d, client };
}

async function call(deviceId, tool, args) {
  const { client, d } = reach(deviceId);
  if (!client.tools.some(t => t.name === tool)) throw bad(`${d.name} does not offer ${tool} (an older client?).`, 501);
  const text = await client.callTool(tool, args);
  if (/^Error:/.test(text)) throw bad(text.replace(/^Error:\s*/, ''), 400);
  try { return JSON.parse(text); } catch { throw bad(`${d.name} answered ${tool} with something that is not JSON.`, 502); }
}

const h = fn => async (req, res) => { try { res.json(await fn(req, req.params.id)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };

function mount(app) {
  const base = '/api/devices/:id/files';
  app.get(`${base}/list`,  h((req, id) => call(id, 'files_list', { path: String(req.query.path || '') })));
  app.get(`${base}/read`,  h((req, id) => call(id, 'files_read', { path: String(req.query.path || '') })));
  app.post(`${base}/write`, h((req, id) => call(id, 'files_write', { path: req.body?.path, content: req.body?.content ?? '' })));
  app.post(`${base}/mkdir`, h((req, id) => call(id, 'files_mkdir', { path: req.body?.path })));
  app.post(`${base}/rename`, h((req, id) => call(id, 'files_move', { from: req.body?.from, to: req.body?.to })));
  app.post(`${base}/delete`, h((req, id) => call(id, 'files_delete', { paths: req.body?.paths || [] })));
  app.post(`${base}/paste`, h(async (req, id) => {
    const { op, paths = [], dest } = req.body || {};
    for (const from of paths) await call(id, op === 'cut' ? 'files_move' : 'files_copy', { from, to: `${String(dest).replace(/[\\/]+$/, '')}/${path.basename(from)}` });
    return { ok: true };
  }));
  // Upload: each file's bytes sent to the device as base64, into `dest`.
  const upload = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 64 << 20, files: 20 } });
  app.post(`${base}/upload`, upload.array('files', 20), h(async (req, id) => {
    const dest = String(req.body?.dest || '').replace(/[\\/]+$/, '');
    const results = [];
    for (const f of req.files || []) {
      try { await call(id, 'files_write', { path: `${dest}/${path.basename(f.originalname)}`, content: f.buffer.toString('base64'), encoding: 'base64' }); results.push({ name: f.originalname, ok: true }); }
      catch (e) { results.push({ name: f.originalname, error: e.message }); }
    }
    return { results };
  }));
  // Download: the file's bytes, fetched from the device as base64.
  app.get(`${base}/download`, async (req, res) => {
    try {
      const r = await call(req.params.id, 'files_read', { path: String(req.query.path || ''), encoding: 'base64' });
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(String(req.query.path || 'file')).replace(/"/g, '')}"`);
      res.type('application/octet-stream').send(Buffer.from(r.content || '', 'base64'));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { mount, reach, call };
