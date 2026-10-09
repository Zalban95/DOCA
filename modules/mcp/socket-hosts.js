'use strict';

/**
 * MCP over a socket the device opens (TODO H5.5): the third transport, beside stdio (a process here) and http (a
 * server the hub dials). A browser extension cannot listen on a port, and a phone off the tailnet has no address the
 * hub can reach — but either can dial out. The device opens `wss://<hub>/api/v1/mcp/host` with its token (scope
 * `mcp:self`; `?access_token=` where a client cannot set headers on a socket) and is then an MCP server on that
 * connection: the hub sends JSON-RPC requests down it and reads the answers, one JSON message per frame.
 *
 * Consent is unchanged: the device offers (`POST /api/v1/mcp/offer {transport: "socket"}`), a person accepts in the
 * MCP tab, and only then is there a definition (`transport: 'socket'`, `origin: client`). While the device is
 * connected the server runs; when it goes, its tools go with it, and they come back when it dials again.
 */
const live = new Map();   // deviceId → { ws, client }
// A device's socket coming and going, and what it pushes beside MCP — `notifications/doca/<what>`, which no MCP
// client reads (a home node's changes: home/nodes.js). Listeners never break the socket.
const events = new (require('events').EventEmitter)();
const tell = (...a) => { try { events.emit(...a); } catch { /* a listener's own failure */ } };

const refuse = (socket, code, text) => socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
let _wss = null;
const wss = () => (_wss = _wss || new (require('ws').WebSocketServer)({ noServer: true, maxPayload: 32 * 1024 * 1024 }));

/** The device's socket: authenticated like any /api/v1 call, one per device (a new one replaces the old). */
function upgrade(req, socket, head) {
  const devices = require('../api-v1/devices'), { hasScope } = require('../api-v1/scopes');
  const token = (/^Bearer\s+(.+)$/i.exec(req.headers.authorization || '') || [])[1] || new URL(req.url, 'http://x').searchParams.get('access_token');
  const device = token && devices.authenticate(String(token).trim());
  if (!device) return refuse(socket, 401, 'Unauthorized');
  if (devices.isPending(device)) return refuse(socket, 403, 'Forbidden');   // waiting for approval (api-v1/pending.js)
  if (device.userId) { const u = require('../auth/store').userById(device.userId); if (!u || u.suspendedAt) return refuse(socket, 401, 'Unauthorized'); }
  if (!hasScope(device.scopes, 'mcp:self')) return refuse(socket, 403, 'Forbidden');
  wss().handleUpgrade(req, socket, head, ws => connected(device.id, ws));
}

function connected(deviceId, ws) {
  const old = live.get(deviceId);
  if (old) try { old.ws.close(4000, 'replaced by a newer connection'); } catch { /* gone */ }
  const entry = { ws, client: null };
  live.set(deviceId, entry);
  ws.on('message', data => {
    let msg; try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg?.id === undefined && /^notifications\/doca\//.test(msg?.method || '')) return tell('notification', deviceId, msg);
    entry.client?._onMessage(msg);
  });
  ws.on('close', () => {
    if (live.get(deviceId) === entry) { live.delete(deviceId); tell('down', deviceId); }
    const c = entry.client;
    if (c && c.child?.ws === ws) {
      c.child = null; c.tools = [];
      if (c.state !== 'stopped') { c.state = 'error'; c.error = 'the device disconnected; its tools come back when it connects again'; }
      c._failAll('the device disconnected');
    }
  });
  require('./registry').wakeForDevice(deviceId);   // an accepted server starts now
  tell('up', deviceId);
}

/** Give a client the device's socket as its pipe (McpClient.start). Throws when the device is not connected. */
function attach(client) {
  const deviceId = client.spec.origin?.deviceId;
  const entry = deviceId && live.get(deviceId);
  if (!entry || entry.ws.readyState !== 1) {
    const d = deviceId && require('../api-v1/devices').get(deviceId);
    throw new Error(`${d?.name || deviceId || 'The device'} is not connected — it dials the hub itself when it runs.`);
  }
  entry.client = client;
  // The shape McpClient's stdio path writes to: stdin.write, and kill() — which for a socket only lets go of it.
  client.child = { ws: entry.ws, killed: false, stdin: { writable: true, write: line => entry.ws.send(String(line).trim()) },
    kill() { this.killed = true; if (entry.client === client) entry.client = null; } };
}

const connectedNow = deviceId => live.has(deviceId);

module.exports = { upgrade, attach, connectedNow, events };
