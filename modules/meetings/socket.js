'use strict';

/**
 * The controller's hand, as a socket: `/ws/meet/<meeting id>?screen=<the page's live stream>`. A pointer moves many
 * times a second, and each move as a POST would be a request, an audit row and a round trip; the socket carries them
 * as frames instead, in order. It carries nothing else: signalling stays on the live feed and the POST routes, and
 * every rule is control.input's — only the controller of an active grant, only while the share lasts.
 *
 * Opening it needs the person's own right to chat (as the live call's socket, realtime/routes.js), a meeting they are
 * in, and a live stream of the page that they opened. Frames in: {grant, kind: move|click|type|keys, fx, fy, button,
 * double, text, keys}; frames out: {ok} or {error}, only for what was not a move.
 */
let _wss = null;
const wss = () => (_wss ||= new (require('ws').WebSocketServer)({ noServer: true }));
const refuse = (socket, code, text) => socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);

async function upgrade(req, socket, head) {
  const who = require('../auth/gate').upgradeAllowed(req, 'chat');
  if (!who) return refuse(socket, 401, 'Unauthorized');
  const u = new URL(req.url, 'http://x');
  const id = decodeURIComponent(u.pathname.split('/')[3] || '');
  const screen = u.searchParams.get('screen') || '';
  const fake = { auth: who };
  const person = require('../harness/turn/client').dashboardClient(fake).user;
  try { await require('./index').reachable(id, person); } catch { return refuse(socket, 404, 'Not Found'); }
  if (!require('../live/routes').owns(fake, screen)) return refuse(socket, 409, 'Conflict');
  wss().handleUpgrade(req, socket, head, ws => {
    ws.on('message', data => {
      let ev;
      try { ev = JSON.parse(String(data)); } catch { return; }
      try {
        const r = require('./control').input(id, screen, ev.grant, ev);
        if (ev.kind !== 'move') ws.send(JSON.stringify({ ok: true, kind: ev.kind, queued: r.queued || null }));
      } catch (e) { try { ws.send(JSON.stringify({ error: e.message, status: e.status || 500 })); } catch { /* gone */ } }
    });
  });
}

module.exports = { upgrade };
