'use strict';

/**
 * DOCA as an MCP server (TODO H9.2; hive.md §3.7): Claude Code, Cursor, Claude Desktop — any MCP client — talk
 * to the hive with a paired device's token, as that device: the person it belongs to, its scopes, the same
 * adapter a phone's message goes through. Streamable HTTP, JSON-RPC over POST /api/v1/mcp, no SSE needed.
 *
 *   doca_chat           a message to a conversation (a new one, or one named); waits for the answer   harness:chat
 *   doca_conversations  the conversations this device's person may open                                harness:sessions
 *   doca_recipes        list the hive's recipes, or run one as the device's person                       harness:chat
 *
 * In Claude Code: { "mcpServers": { "doca": { "type": "http", "url": "https://<hub>:4242/api/v1/mcp",
 * "headers": { "Authorization": "Bearer doca_…" } } } } (the hub's certificate is self-signed: trust it, or
 * reach the hub over the tailnet's own HTTPS).
 */
const harness = require('./harness');
const { can } = require('./auth');

const ANSWER_WAIT_MS = 10 * 60 * 1000;

const TOOLS = [
  { name: 'doca_chat', scope: 'harness:chat',
    description: 'Send a message to the DOCA hive and wait for its answer. It runs as a turn in a conversation (a new one unless you pass conversation), with the hive\'s own tools, memory, approvals and the person\'s level.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' }, conversation: { type: 'string', description: 'A conversation id from doca_conversations, or omit for a new one.' } }, required: ['message'] } },
  { name: 'doca_conversations', scope: 'harness:sessions',
    description: 'The conversations in the DOCA hive this device\'s person may open: id, title, when it was last used.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'doca_recipes', scope: 'harness:chat',
    description: 'DOCA recipes — saved sequences of tool calls that run without a model. action list shows them; action run runs one (id, values) as the device\'s person, with their approvals, and returns each step\'s outcome.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'run'] }, id: { type: 'string' }, values: { type: 'object' } }, required: ['action'] } },
];

const text = t => ({ content: [{ type: 'text', text: String(t) }] });
const fail = t => ({ content: [{ type: 'text', text: String(t) }], isError: true });

/** Post the message the way a device does, and wait for that turn's outcome on the bus. */
function chat(device, { message, conversation }) {
  const bus = require('./bus');
  let sessionId = conversation || harness.createSession(String(message).slice(0, 60), { activate: false, device }).id;
  return new Promise((resolve) => {
    let turnId = null;
    const timer = setTimeout(() => { bus.emitter.off('event', on); resolve(fail(`No answer within ${ANSWER_WAIT_MS / 60000} minutes; the turn may still be running in conversation ${sessionId}.`)); }, ANSWER_WAIT_MS);
    const on = (deviceId, env) => {
      if (deviceId !== device.id || env.type !== 'agent.turn' || env.payload?.turnId !== turnId) return;
      const p = env.payload;
      if (p.state === 'started') return;
      clearTimeout(timer); bus.emitter.off('event', on);
      if (p.state === 'done') resolve(text(`${p.text || '(no text)'}\n\n[conversation ${sessionId}]`));
      else resolve(fail(p.state === 'cancelled' ? 'The turn was stopped.' : `The turn failed: ${p.error?.message || 'unknown error'}`));
    };
    bus.emitter.on('event', on);
    try { ({ turnId, sessionId } = harness.post({ message, sessionId }, device)); }
    catch (e) { clearTimeout(timer); bus.emitter.off('event', on); resolve(fail(e.message)); }
  });
}

async function callTool(req, name, args = {}) {
  const t = TOOLS.find(x => x.name === name);
  if (!t) return fail(`No tool ${name}.`);
  if (!can(req, t.scope)) return fail(`This device's token lacks ${t.scope}.`);
  const device = require('./devices').get(req.device.id);
  if (name === 'doca_chat') return chat(device, args);
  if (name === 'doca_conversations') {
    const { sessions } = harness.sessions(device);
    return text(sessions.filter(s => !s.archivedAt).slice(0, 50).map(s => `${s.id}  ${s.title}  (${s.updatedAt || ''})`).join('\n') || 'No conversations.');
  }
  if (name === 'doca_recipes') {
    const store = require('../recipes/store');
    if (args.action === 'list') return text(store.list().map(r => `${r.id} — ${r.title}${r.params.length ? ` (params: ${r.params.map(p => p.name).join(', ')})` : ''}${r.description ? `: ${r.description}` : ''}`).join('\n') || 'No recipes.');
    const r = store.get(args.id);
    if (!r) return fail(`No recipe "${args.id}".`);
    const person = require('../harness/turn/client').deviceOwner(device);
    const out = await require('../recipes/run').run(r, { params: args.values || {}, person, client: { name: device.name, kind: device.kind, user: person } });
    return (out.ok ? text : fail)(`${out.summary}\n${out.steps.map(s => `${s.n}. ${s.tool}: ${s.ok ? 'ok' : `failed — ${s.why}`}`).join('\n')}`);
  }
  return fail(`No tool ${name}.`);
}

async function handle(req, msg) {
  const ok = result => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') return ok({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'doca', version: require('../../package.json').version } });
  if (msg.method === 'tools/list') return ok({ tools: TOOLS.filter(t => can(req, t.scope)).map(({ scope, ...t }) => t) });
  if (msg.method === 'tools/call') return ok(await callTool(req, msg.params?.name, msg.params?.arguments || {}));
  if (msg.method === 'ping') return ok({});
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } };
}

function mount(router) {
  router.post('/mcp', async (req, res) => {
    const msg = req.body || {};
    if (msg.id === undefined) return res.status(202).end();   // a notification
    try { res.json(await handle(req, msg)); }
    catch (e) { res.json({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } }); }
  });
  router.get('/mcp', (_req, res) => res.status(405).json({ error: 'POST JSON-RPC here (MCP streamable HTTP, no server-sent stream).' }));
}

module.exports = { mount, TOOLS };
