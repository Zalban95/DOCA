'use strict';

/**
 * A minimal MCP server over Streamable HTTP, in-process, for the tests.
 *
 * This is the shape a *client machine* hosts: DOCA cannot spawn a process on
 * somebody else's desktop, so a client-hosted server is always reached over
 * HTTP. `modules/mcp/client.js` POSTs one JSON-RPC request and reads one reply,
 * which is the whole contract — it never holds an event stream open.
 *
 * Started in-process rather than as a child on purpose: there is no stdio to
 * mimic here, and a plain `http.Server` on an ephemeral port is both faster and
 * closer to what is being tested.
 *
 * `sse: true` answers with `text/event-stream` framing instead of plain JSON,
 * because the client accepts either and both shapes are real.
 *
 * `stream: true` also serves the GET event stream; `push(msg)` sends a message
 * down every open one and `addTool(t)` changes what tools/list answers. Without
 * it a GET is a 405 — a server that offers no stream, which is allowed.
 */
const http = require('http');

const TOOLS = [
  {
    name: 'list_windows',
    description: 'List the windows open on this desktop.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'type_text',
    description: 'Type into the focused window, which changes something.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  },
];

/**
 * @param {{ sse?: boolean, requirePath?: string }} opts
 *   `requirePath` refuses anything else with a 404, the way a listener that puts
 *   a secret in its URL does.
 * @returns {Promise<{ url: string, close: () => Promise<void>, seen: object[] }>}
 */
async function start(opts = {}) {
  const seen = [];
  const tools = [...TOOLS];
  const streams = new Set();

  let down = false, cut = 0;   // drop(): every request is cut off, the way a listener that went away looks

  const server = http.createServer((req, res) => {
    if (down) { cut++; req.socket.destroy(); return; }
    if (req.method === 'GET' && opts.stream) {
      seen.push({ method: 'GET', headers: req.headers });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(': open\n\n');
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    if (opts.requirePath && req.url !== opts.requirePath) { res.writeHead(404).end('no'); return; }

    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let msg;
      try { msg = JSON.parse(body); } catch { res.writeHead(400).end('bad json'); return; }
      seen.push({ method: msg.method, headers: req.headers });

      let result;
      if (msg.method === 'initialize') {
        result = {
          protocolVersion: msg.params?.protocolVersion || '2025-06-18',
          capabilities: { tools: opts.stream ? { listChanged: true } : {} },
          serverInfo: { name: 'http-stub', version: '2.0.0' },
        };
      } else if (msg.method === 'tools/list') {
        result = { tools };
      } else if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params || {};
        result = name === 'list_windows'
          ? { content: [{ type: 'text', text: 'Notepad\nBlender' }] }
          : name === 'type_text'
            ? { content: [{ type: 'text', text: `typed ${args?.text ?? ''}` }] }
            : { content: [{ type: 'text', text: `no tool named ${name}` }], isError: true };
      } else if (msg.id === undefined) {
        res.writeHead(202).end();                       // a notification
        return;
      } else {
        const payload = JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `${msg.method} not supported` } });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(payload);
        return;
      }

      const payload = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
      // A session id the client is expected to echo back on later calls.
      if (opts.sse) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 'sess-http-stub' });
        // `noteFirst`: a notification on the same response, ahead of the reply, as servers may send.
        const note = opts.noteFirst && msg.method === 'tools/call' ? `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })}\n\n` : '';
        res.end(`${note}event: message\ndata: ${payload}\n\n`);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-http-stub' });
        res.end(payload);
      }
    });
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}${opts.requirePath || '/mcp'}`,
    seen,
    streams,
    push: msg => { for (const r of streams) r.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`); },
    addTool: t => tools.push(t),
    /** Go away: open streams are cut and every new request is reset, until resume(). */
    drop: () => { down = true; for (const r of streams) r.socket?.destroy(); streams.clear(); },
    resume: () => { down = false; },
    /** How many requests drop() has cut off. */
    get cut() { return cut; },
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }),
  };
}

module.exports = { start, TOOLS };
