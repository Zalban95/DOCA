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

/** Pipe an authorised upgrade to websockify in the computer. */
function upgrade(req, socket, head) {
  const id = (req.url.match(/^\/ws\/computer\/([a-f0-9]+)/) || [])[1];
  const port = id && portOf(id);
  if (!port) return socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  const up = net.connect(port, '127.0.0.1', () => {
    const headers = Object.entries(req.headers).filter(([k]) => k !== 'host').map(([k, v]) => `${k}: ${v}`);
    up.write(`GET /websockify HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\n${headers.join('\r\n')}\r\n\r\n`);
    if (head?.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  const close = () => { up.destroy(); socket.destroy(); };
  up.on('error', close); socket.on('error', close);
}

/** The link a person opens: through the hub, connecting by itself, scaled to the window. */
const watchUrl = c => `/computers/${c.id}/vnc/vnc.html?autoconnect=1&resize=scale&reconnect=1&path=ws/computer/${c.id}&password=${encodeURIComponent(c.vncPassword)}`;

module.exports = { page, upgrade, watchUrl };
