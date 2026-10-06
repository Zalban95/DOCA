'use strict';

/**
 * A2A — Agent2Agent (TODO H9.2; hive.md §3.7): another agent delegates to the hive as a paired device. The agent card
 * is public at `/.well-known/agent-card.json` (and the older `/.well-known/agent.json`): who the hive is, where to
 * talk (`/api/v1/a2a`) and that a device's bearer token is required. `POST /api/v1/a2a` is JSON-RPC 2.0:
 *
 *   message/send   the message's text parts become a turn as the device (harness.post, its person's level and
 *                  approvals); blocks until the turn ends and answers with the Task — `completed` with the answer as
 *                  an agent message and an artifact, `failed`, or `canceled`. `contextId` is a conversation (one of
 *                  the person's ids, or mapped to one of its own); `configuration.blocking: false` answers at once
 *                  with the Task `working`, to be read with tasks/get.
 *   tasks/get      a task this device started (kept in memory for an hour)
 *   tasks/cancel   stops it at the next step
 *
 * Text only (`defaultInputModes`/`OutputModes` text/plain); no streaming yet — the card says so.
 */
const crypto = require('crypto');
const harness = require('./harness');
const { can } = require('./auth');

const DOC = 'a2a-contexts';
const WAIT_MS = 10 * 60 * 1000;
const tasks = new Map();   // taskId (the turn id) → { deviceId, contextId, state, text, error, at }
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

function card(req) {
  const b = require('../branding');
  return { protocolVersion: '0.3.0', name: b.name('product'), description: `${b.name('product')}: a hive of agents with tools, memory, computers and the person's devices. A message is a turn, run as the paired device you authenticate with.`,
    url: `${req.protocol}://${req.get('host')}/api/v1/a2a`, preferredTransport: 'JSONRPC', version: require('../../package.json').version,
    provider: { organization: b.name('vendor'), url: `${req.protocol}://${req.get('host')}/` },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'A DOCA device token holding harness:chat (Field → API keys, or pair a device).' } },
    security: [{ bearer: [] }],
    skills: [{ id: 'chat', name: 'Ask the hive', description: 'Anything its agents can do: research, run work on its machines, use its tools and memory, ask its person on a device.', tags: ['assistant', 'tools', 'memory'], examples: ['What is running on the server?', 'Summarise the open issues in the project.'] }] };
}

function contextFor(device, contextId, words) {
  const store = require('../store');
  if (contextId) {
    try { harness.requireSession(contextId, device); return contextId; } catch { /* not one of theirs */ }
    const map = store.readJson(DOC, {}), key = `${device.id}:${contextId}`;
    if (map[key]) { try { harness.requireSession(map[key], device); return map[key]; } catch { /* deleted */ } }
    const s = harness.createSession(words.slice(0, 60) || 'A2A', { activate: false, device });
    store.writeJson(DOC, { ...map, [key]: s.id });
    return s.id;
  }
  return harness.createSession(words.slice(0, 60) || 'A2A', { activate: false, device }).id;
}

function taskView(id, t) {
  const done = t.state === 'completed';
  return { kind: 'task', id, contextId: t.contextId,
    status: { state: t.state, timestamp: new Date(t.at).toISOString(),
      ...(done ? { message: { kind: 'message', role: 'agent', messageId: `${id}-answer`, parts: [{ kind: 'text', text: t.text }], taskId: id, contextId: t.contextId } } : {}),
      ...(t.state === 'failed' ? { message: { kind: 'message', role: 'agent', messageId: `${id}-error`, parts: [{ kind: 'text', text: t.error }], taskId: id, contextId: t.contextId } } : {}) },
    ...(done ? { artifacts: [{ artifactId: `${id}-answer`, name: 'answer', parts: [{ kind: 'text', text: t.text }] }] } : {}) };
}

/** Start the turn: its task id, and a promise that settles when it ends (the bus's agent.turn for it). */
function send(device, message, contextId) {
  const bus = require('./bus');
  let taskId = null, settle;
  const finished = new Promise(r => { settle = r; });
  const on = (deviceId, env) => {
    if (deviceId !== device.id || env.type !== 'agent.turn' || env.payload?.turnId !== taskId || env.payload.state === 'started') return;
    bus.emitter.off('event', on);
    const p = env.payload;
    Object.assign(tasks.get(taskId), { state: p.state === 'done' ? 'completed' : p.state === 'cancelled' ? 'canceled' : 'failed',
      text: p.text || '', error: p.error?.message || null, at: Date.now() });
    settle();
  };
  bus.emitter.on('event', on);   // agent.turn is durable: published whether or not the device is listening
  try { ({ turnId: taskId } = harness.post({ message, sessionId: contextId }, device)); }
  catch (e) { bus.emitter.off('event', on); throw e; }
  tasks.set(taskId, { deviceId: device.id, contextId, state: 'working', text: '', error: null, at: Date.now() });
  return { taskId, finished };
}

async function handle(req, msg) {
  const id = msg.id ?? null;
  if (!can(req, 'harness:chat')) return rpcError(id, -32001, 'This device\'s token lacks harness:chat.');
  const device = require('./devices').get(req.device.id);
  for (const [k, t] of tasks) if (Date.now() - t.at > 3600000 && t.state !== 'working') tasks.delete(k);
  const p = msg.params || {};
  if (msg.method === 'message/send') {
    const m = p.message || {};
    const text = (m.parts || []).filter(x => (x.kind || x.type) === 'text').map(x => x.text).join('\n').trim();
    if (!text) return rpcError(id, -32602, 'message.parts needs a text part (only text is accepted).');
    let ctx;
    try { ctx = contextFor(device, m.contextId || p.contextId, text); } catch (e) { return rpcError(id, -32602, e.message); }
    let taskId, finished;
    try { ({ taskId, finished } = send(device, text, ctx)); } catch (e) { return rpcError(id, -32603, e.message); }
    if (p.configuration?.blocking === false) return { jsonrpc: '2.0', id, result: taskView(taskId, tasks.get(taskId)) };
    await Promise.race([finished, new Promise(r => setTimeout(r, WAIT_MS).unref())]);
    return { jsonrpc: '2.0', id, result: taskView(taskId, tasks.get(taskId)) };
  }
  if (msg.method === 'tasks/get' || msg.method === 'tasks/cancel') {
    const t = tasks.get(String(p.id || ''));
    if (!t || t.deviceId !== device.id) return rpcError(id, -32001, 'Task not found.');
    if (msg.method === 'tasks/cancel') {
      if (t.state !== 'working') return rpcError(id, -32002, `Task is ${t.state}; it cannot be canceled.`);
      try { harness.cancel(String(p.id), device); } catch (e) { return rpcError(id, -32002, e.message); }
    }
    return { jsonrpc: '2.0', id, result: taskView(String(p.id), t) };
  }
  return rpcError(id, -32601, `Method not found: ${msg.method}`);
}

/** The card at the hub's root (public), and the endpoint under /api/v1 (a device token). */
function mountCard(app) {
  for (const p of ['/.well-known/agent-card.json', '/.well-known/agent.json']) app.get(p, (req, res) => res.json(card(req)));
}
function mount(router) {
  router.post('/a2a', async (req, res) => {
    const msg = req.body || {};
    try { res.json(await handle(req, msg)); } catch (e) { res.json(rpcError(msg.id ?? null, -32603, e.message)); }
  });
}

module.exports = { mount, mountCard, card };
