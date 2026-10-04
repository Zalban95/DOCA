'use strict';

/**
 * A computer's control server: an MCP server over streamable HTTP, which the
 * hub connects to like any other (modules/mcp) — so a computer is a client of
 * the hive lending its tools, the shape every client is meant to have
 * (docs/design/hive.md §4). No dependency: Node 22's fetch and WebSocket.
 *
 *   POST /mcp   JSON-RPC: initialize, tools/list, tools/call (Bearer TOKEN)
 *   GET  /health
 */
const http = require('http');
const { TOOLS } = require('./tools');

const PORT = Number(process.env.PORT) || 8765;
const TOKEN = process.env.TOKEN || '';
if (!TOKEN) { console.error('TOKEN is required: the hub passes it, and nothing answers without it.'); process.exit(2); }

function reply(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function handle(msg) {
  const ok = result => ({ jsonrpc: '2.0', id: msg.id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  if (msg.method === 'initialize') {
    return ok({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} },
      serverInfo: { name: 'doca-computer', version: '1.0.0' } });
  }
  if (msg.method === 'tools/list') return ok({ tools: TOOLS.map(({ run, ...t }) => t) });
  if (msg.method === 'tools/call') {
    const t = TOOLS.find(x => x.name === msg.params?.name);
    if (!t) return err(-32602, `No tool ${msg.params?.name}`);
    try { return ok(await t.run(msg.params?.arguments || {})); }
    catch (e) { return ok({ content: [{ type: 'text', text: e.message }], isError: true }); }
  }
  if (msg.method === 'ping') return ok({});
  return err(-32601, `Unknown method ${msg.method}`);
}

http.createServer((req, res) => {
  if (req.url === '/health') return reply(res, 200, { ok: true });
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(res, 401, { error: 'unauthorized' });
  if (req.method !== 'POST') return reply(res, 405, { error: 'POST JSON-RPC to /mcp' });
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 50e6) req.destroy(); });
  req.on('end', async () => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return reply(res, 400, { error: 'not JSON' }); }
    if (msg.id === undefined) return reply(res, 202);   // a notification
    reply(res, 200, await handle(msg), { 'Mcp-Session-Id': 'computer' });
  });
}).listen(PORT, '0.0.0.0', () => console.log(`computer agent on :${PORT}`));
