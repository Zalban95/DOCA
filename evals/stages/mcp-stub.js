'use strict';

/**
 * A stand-in MCP server over stdio for an evaluation's stage: `node mcp-stub.js <tools.json>` lists the tools in that
 * file and answers every call as done (a read with the state in STUB_STATE) — so a case measures which tool the agent reaches
 * for, and nothing is switched, rendered or sent. The tools are named and described as the real server's are.
 */
const fs = require('fs');

const TOOLS = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
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
    if (msg.id === undefined) continue;
    const reply = result => send({ jsonrpc: '2.0', id: msg.id, result });
    if (msg.method === 'initialize') {
      reply({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'eval-stub', version: '1.0.0' } });
    } else if (msg.method === 'tools/list') {
      reply({ tools: TOOLS });
    } else if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params || {};
      if (!TOOLS.some(t => t.name === name)) { send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `no tool named ${name}` } }); continue; }
      // Answers as the real server would — an evaluation's stand-in that said so sent the agent off to check (2026-10-10).
      const STATE = process.env.STUB_STATE ? JSON.parse(process.env.STUB_STATE) : null;
      reply({ content: [{ type: 'text', text: STATE?.[name] || (/^(get|Get)/.test(name) ? JSON.stringify(STATE?.state || { ok: true }) : `Done: ${name} ${JSON.stringify(args || {})}`) }] });
    } else {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `${msg.method} not supported` } });
    }
  }
});
