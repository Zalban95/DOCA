'use strict';

/**
 * A stub Home Assistant: its WebSocket API (auth, get_states, get_config, the registries, subscribe_events,
 * call_service) and its camera proxy — what a home node and the hub's direct link speak to.
 */
const http = require('node:http');
const { WebSocketServer } = require('ws');

function start({ token, place = 'Test House', states = [], areas = [], entities = [] } = {}) {
  const ha = { calls: [], sockets: new Set(), cameraAuth: null, origin: null };
  const server = http.createServer((req, res) => {
    const m = /^\/api\/camera_proxy\/(camera\.\w+)$/.exec(req.url);
    if (m && states.some(s => s.entity_id === m[1])) { ha.cameraAuth = req.headers.authorization; res.setHeader('Content-Type', 'image/jpeg'); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); }
    res.statusCode = 404; res.end();
  });
  const wss = new WebSocketServer({ server, path: '/api/websocket' });
  wss.on('connection', ws => {
    ha.sockets.add(ws);
    ws.on('close', () => ha.sockets.delete(ws));
    const send = o => ws.send(JSON.stringify(o));
    send({ type: 'auth_required', ha_version: '2026.10.0' });
    ws.on('message', raw => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'auth') return msg.access_token === token ? send({ type: 'auth_ok', ha_version: '2026.10.0' }) : send({ type: 'auth_invalid', message: 'Invalid access token or password' });
      const ok = result => send({ id: msg.id, type: 'result', success: true, result });
      if (msg.type === 'get_states') return ok(states);
      if (msg.type === 'get_config') return ok({ location_name: place, unit_system: { temperature: '°C' } });
      if (msg.type === 'config/area_registry/list') return ok(areas);
      if (msg.type === 'config/device_registry/list') return ok([]);
      if (msg.type === 'config/entity_registry/list') return ok(entities);
      if (msg.type === 'subscribe_events') { if (msg.event_type === 'state_changed') ws.sub = msg.id; return ok(null); }
      if (msg.type === 'call_service') { ha.calls.push(msg); return ok({ context: {} }); }
      send({ id: msg.id, type: 'result', success: false, error: { code: 'unknown_command', message: 'Unknown command.' } });
    });
  });
  /** An entity changes, as HA tells every subscriber. */
  ha.changed = (entity_id, state, attributes = {}) => {
    for (const s of ha.sockets) if (s.sub) s.send(JSON.stringify({ id: s.sub, type: 'event', event: { event_type: 'state_changed', data: { entity_id, new_state: { entity_id, state, attributes } } } }));
  };
  ha.close = () => { for (const s of ha.sockets) s.terminate(); server.close(); };
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => { ha.origin = `http://127.0.0.1:${server.address().port}`; resolve(ha); }));
}

module.exports = { start };
