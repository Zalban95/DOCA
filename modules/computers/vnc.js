'use strict';

/**
 * A computer's screen through the hub (TODO H7.2a): noVNC listens on the host's 127.0.0.1 only, so before
 * this only a browser on this machine could watch a computer. The page is proxied by an ordinary route (the
 * gate's host right applies) and its WebSocket by the upgrade router (modules/terminal.js), which already
 * demands the host right, a recent sign-in and this panel's own page — so a phone on the tailnet can watch
 * and take over, and nobody else can.
 *
 *   GET /computers/:id/vnc/<file>   noVNC's files, from the computer
 *   WS  /ws/computer/:id            its VNC stream (websockify inside the computer)
 */
const http = require('http');
const net = require('net');

const portOf = id => require('./index').get(String(id))?.vncPort || null;

function page(req, res) {
  const port = portOf(req.params.id);
  if (!port) return res.status(404).type('text/plain').send('No such computer.');
  const rel = req.params[0] || 'vnc.html';
  const up = http.get({ host: '127.0.0.1', port, path: `/${rel}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}` }, r => {
    res.status(r.statusCode);
    for (const h of ['content-type', 'content-length', 'last-modified', 'etag']) if (r.headers[h]) res.setHeader(h, r.headers[h]);
    r.pipe(res);
  });
  up.on('error', () => res.status(502).type('text/plain').send('The computer is not answering — is it running?'));
}

/**
 * Who is driving (TODO H13.3): a take-over socket (`?drive=1`) counts as a person at the keyboard until it
 * closes; while one is open the agent's own input tools wait (computers/takeover.js). Watching does not count.
 */
const _drivers = new Map();   // id -> open take-over sockets
const _handedBack = new Map();   // id -> when the last one closed
const driving = id => (_drivers.get(id) || 0) > 0;
const handedBack = id => _handedBack.get(id) || null;
const clearHandBack = id => _handedBack.delete(id);

/** Pipe an authorised upgrade to websockify in the computer. */
function upgrade(req, socket, head) {
  const id = (req.url.match(/^\/ws\/computer\/([a-f0-9]+)/) || [])[1];
  const port = id && portOf(id);
  if (!port) return socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  if (/[?&]drive=1\b/.test(req.url)) {
    _drivers.set(id, (_drivers.get(id) || 0) + 1);
    socket.once('close', () => { const n = (_drivers.get(id) || 1) - 1; if (n > 0) _drivers.set(id, n); else { _drivers.delete(id); _handedBack.set(id, new Date().toISOString()); } });
  }
  const up = net.connect(port, '127.0.0.1', () => {
    const headers = Object.entries(req.headers).filter(([k]) => k !== 'host').map(([k, v]) => `${k}: ${v}`);
    up.write(`GET /websockify HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\n${headers.join('\r\n')}\r\n\r\n`);
    if (head?.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  const close = () => { up.destroy(); socket.destroy(); };
  up.on('error', close); socket.on('error', close);
}

/** The links a person opens: through the hub, connecting by itself, scaled to the window — to watch (view only) or to drive. */
const watchUrl = c => `/computers/${c.id}/vnc/vnc.html?autoconnect=1&resize=scale&reconnect=1&view_only=1&path=${encodeURIComponent(`ws/computer/${c.id}`)}&password=${encodeURIComponent(c.vncPassword)}`;
const driveUrl = c => `/computers/${c.id}/vnc/vnc.html?autoconnect=1&resize=scale&reconnect=1&path=${encodeURIComponent(`ws/computer/${c.id}?drive=1`)}&password=${encodeURIComponent(c.vncPassword)}`;

module.exports = { page, upgrade, watchUrl, driveUrl, driving, handedBack, clearHandBack };
