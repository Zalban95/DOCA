'use strict';

/**
 * A stand-in for a device's files family (PROTOCOL §22.1): an MCP server over
 * HTTP offering files_list / read / write / mkdir / move / copy / delete over a
 * folder, the way DocaDesk will. For tests of modules/device-files.js.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const TOOLS = ['files_list', 'files_read', 'files_write', 'files_mkdir', 'files_move', 'files_copy', 'files_delete']
  .map(name => ({ name, description: name, inputSchema: { type: 'object', properties: {} } }));

async function start(root) {
  const inside = p => { const abs = path.resolve(root, String(p || '.')); if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('outside this device\'s shared folder'); return abs; };
  const run = (name, a) => {
    switch (name) {
      case 'files_list': { const dir = inside(a.path || root); return { path: dir, entries: fs.readdirSync(dir, { withFileTypes: true }).map(e => {
        const st = fs.statSync(path.join(dir, e.name)); return { name: e.name, isDir: e.isDirectory(), size: e.isDirectory() ? null : st.size, mtime: st.mtime.toISOString() }; }) }; }
      case 'files_read': { const f = inside(a.path); const b = fs.readFileSync(f); return { content: a.encoding === 'base64' ? b.toString('base64') : b.toString('utf8'), size: b.length, mtime: fs.statSync(f).mtime.toISOString() }; }
      case 'files_write': fs.writeFileSync(inside(a.path), a.encoding === 'base64' ? Buffer.from(a.content, 'base64') : a.content); return { ok: true };
      case 'files_mkdir': fs.mkdirSync(inside(a.path), { recursive: true }); return { ok: true };
      case 'files_move': fs.renameSync(inside(a.from), inside(a.to)); return { ok: true };
      case 'files_copy': fs.cpSync(inside(a.from), inside(a.to), { recursive: true }); return { ok: true };
      case 'files_delete': for (const p of a.paths || []) fs.rmSync(inside(p), { recursive: true, force: true }); return { ok: true };
      default: throw new Error(`no tool ${name}`);
    }
  };
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      const m = JSON.parse(body || '{}');
      if (m.id === undefined) { res.writeHead(202).end(); return; }
      let result;
      if (m.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'device-stub' } };
      else if (m.method === 'tools/list') result = { tools: TOOLS };
      else if (m.method === 'tools/call') {
        try { result = { content: [{ type: 'text', text: JSON.stringify(run(m.params.name, m.params.arguments || {})) }] }; }
        catch (e) { result = { content: [{ type: 'text', text: e.message }], isError: true }; }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) };
}

module.exports = { start };
