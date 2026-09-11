'use strict';

/**
 * A minimal MCP server over stdio, for the tests.
 *
 * Speaks just enough of the protocol to be indistinguishable from a real one
 * from the client's side: initialize, tools/list, tools/call. It also writes a
 * line to stderr on startup, which is what the log panel is expected to show.
 *
 * `node mcp-stub-server.js --fail` exits immediately instead, to exercise a
 * server that refuses to start.
 */
if (process.argv.includes('--fail')) {
  process.stderr.write('stub: refusing to start, as asked\n');
  process.exit(3);
}

process.stderr.write('stub MCP server listening on stdio\n');

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo a message straight back.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'write_thing',
    description: 'Pretend to change something, so it counts as not read-only.',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
  },
  {
    name: 'explode',
    description: 'Always answers with isError, to exercise a failing tool call.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const send = msg => process.stdout.write(`${JSON.stringify(msg)}\n`);

let buf = '';
process.stdin.on('data', chunk => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;

    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === undefined) continue;                  // a notification

    const reply = result => send({ jsonrpc: '2.0', id: msg.id, result });

    if (msg.method === 'initialize') {
      reply({
        protocolVersion: msg.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'stub', version: '1.0.0' },
      });
    } else if (msg.method === 'tools/list') {
      reply({ tools: TOOLS });
    } else if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params || {};
      if (name === 'echo') {
        reply({ content: [{ type: 'text', text: `echo: ${args?.message ?? ''}` }] });
      } else if (name === 'write_thing') {
        reply({ content: [{ type: 'text', text: `wrote ${args?.value ?? ''}` }] });
      } else if (name === 'explode') {
        reply({ content: [{ type: 'text', text: 'that did not work' }], isError: true });
      } else {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `no tool named ${name}` } });
      }
    } else {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `${msg.method} not supported` } });
    }
  }
});
